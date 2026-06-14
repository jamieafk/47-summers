// Fling milestone receiver.
//
// Honors the exact contract the shipped iOS app expects (see
// ../../launch/milestone-telemetry.md in the swish repo):
//   POST application/json, header Idempotency-Key: {install_id}:{milestone}
//   body: { schema_version, event:"fling_milestone", idempotency_key,
//           install_id, milestone(10|100|500|1000), total_flings,
//           app_version, build, created_at(ISO8601) }
//   - any 2xx = delivered forever (app never resends), so PERSIST before 2xx
//   - duplicates MUST return 2xx (treated as success, app clears them)
//   - non-2xx / slow / unreachable = app keeps it queued and retries later
//   - 5s client timeout, so respond well under that

import { json } from "./http.js"

export const VALID_MILESTONES = new Set([10, 100, 500, 1000])
const MAX_BODY_BYTES = 4096

export async function handleMilestone(request, env, ctx) {
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405)
  }

  const contentType = (request.headers.get("content-type") || "").toLowerCase()
  if (!contentType.includes("application/json")) {
    return json({ error: "unsupported_media_type" }, 415)
  }

  // Size guard — declared and actual.
  if (Number(request.headers.get("content-length") || "0") > MAX_BODY_BYTES) {
    return json({ error: "payload_too_large" }, 413)
  }
  const raw = await request.text()
  if (raw.length > MAX_BODY_BYTES) {
    return json({ error: "payload_too_large" }, 413)
  }

  let body
  try {
    body = JSON.parse(raw)
  } catch {
    return json({ error: "invalid_json" }, 400)
  }

  // Validation per the spec. 4xx here is for malformed/abusive input — the real
  // app never sends these, and a 4xx tells it not to retry junk.
  if (body.event !== "fling_milestone") {
    return json({ error: "invalid_event" }, 422)
  }
  const milestone = Number(body.milestone)
  if (!VALID_MILESTONES.has(milestone)) {
    return json({ error: "invalid_milestone" }, 422)
  }
  const installID = typeof body.install_id === "string" ? body.install_id.trim() : ""
  if (!installID) {
    return json({ error: "missing_install_id" }, 422)
  }

  // idempotency_key: prefer the body field, fall back to the header, then build
  // it. All three are the same value by construction in the app.
  const idempotencyKey =
    (typeof body.idempotency_key === "string" && body.idempotency_key) ||
    request.headers.get("idempotency-key") ||
    `${installID}:${milestone}`

  const ip = request.headers.get("cf-connecting-ip") || ""
  const ipHash = await hashIP(ip, env.IP_SALT || "")
  const receivedAt = new Date().toISOString()

  // Soft rate limit by IP hash (best-effort; legit installs send <=4 events ever).
  const limit = Number(env.RATE_LIMIT_PER_HOUR || "0")
  if (limit > 0 && ipHash) {
    try {
      const sinceISO = new Date(Date.now() - 3600_000).toISOString()
      const row = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM milestone_events WHERE ip_hash = ? AND received_at > ?"
      )
        .bind(ipHash, sinceISO)
        .first()
      if (row && Number(row.n) >= limit) {
        return json({ error: "rate_limited" }, 429)
      }
    } catch {
      // Soft limit: on a transient read error, skip the check and let the event
      // through rather than deferring a legitimate milestone.
    }
  }

  // Dedupe is enforced by the PRIMARY KEY: INSERT OR IGNORE is a no-op on a
  // duplicate key, and meta.changes tells us whether a row was actually written.
  let inserted = false
  try {
    const result = await env.DB.prepare(
      `INSERT OR IGNORE INTO milestone_events
       (idempotency_key, install_id, milestone, total_flings, app_version, build, created_at, received_at, ip_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        idempotencyKey,
        installID,
        milestone,
        intOrNull(body.total_flings),
        strOrNull(body.app_version),
        strOrNull(body.build),
        strOrNull(body.created_at) || receivedAt,
        receivedAt,
        ipHash || null
      )
      .run()
    inserted = (result?.meta?.changes ?? 0) > 0
  } catch {
    // Transient storage error → 5xx so the app keeps the event queued and retries.
    return json({ error: "storage_error" }, 503)
  }

  // Alert only on a genuinely new row, so duplicate retries never spam.
  if (inserted && env.DISCORD_WEBHOOK) {
    const alert = sendDiscordAlert(env.DISCORD_WEBHOOK, {
      milestone,
      installID,
      totalFlings: intOrNull(body.total_flings),
    })
    if (ctx && typeof ctx.waitUntil === "function") {
      ctx.waitUntil(alert)
    } else {
      await alert.catch(() => {})
    }
  }

  // Duplicate still returns 2xx — the app must be able to clear it.
  return json({ ok: true, duplicate: !inserted }, 200)
}

export async function handleStats(request, env) {
  if (request.method !== "GET") {
    return json({ error: "method_not_allowed" }, 405)
  }
  const key = new URL(request.url).searchParams.get("key") || ""
  if (!env.STATS_KEY || !timingSafeEqual(key, env.STATS_KEY)) {
    return json({ error: "unauthorized" }, 401)
  }
  try {
    const byMilestone = await env.DB.prepare(
      "SELECT milestone, COUNT(*) AS events, COUNT(DISTINCT install_id) AS installs FROM milestone_events GROUP BY milestone ORDER BY milestone"
    ).all()
    const totalRow = await env.DB.prepare(
      "SELECT COUNT(DISTINCT install_id) AS installs FROM milestone_events"
    ).first()
    return json({
      milestones: byMilestone?.results ?? [],
      unique_installs: totalRow ? Number(totalRow.installs) : 0,
    })
  } catch {
    return json({ error: "database_error" }, 503)
  }
}

function intOrNull(v) {
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

function strOrNull(v) {
  return typeof v === "string" && v.length ? v : null
}

async function hashIP(ip, salt) {
  if (!ip) return ""
  const data = new TextEncoder().encode(`${salt}:${ip}`)
  const digest = await crypto.subtle.digest("SHA-256", data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) {
    return false
  }
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

async function sendDiscordAlert(webhookURL, { milestone, installID, totalFlings }) {
  const short = installID.slice(0, 8)
  const total = totalFlings ? ` (total ${totalFlings})` : ""
  const content = `🪁 Fling milestone: an install just crossed **${milestone}** Flings${total}. install \`${short}…\``
  await fetch(webhookURL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content }),
  })
}
