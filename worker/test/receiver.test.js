// Contract tests for the Fling milestone receiver.
// Runs the real handlers in plain Node against a fake D1 + mocked fetch —
// no Cloudflare account needed to prove correctness.

import { test, mock, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { handleMilestone, handleStats } from "../src/receiver.js"

// --- Fake D1 -----------------------------------------------------------------
// Interprets the exact queries the receiver issues, backed by an in-memory array.
class FakeD1 {
  constructor() {
    this.events = []
    this.throwOnInsert = false
  }
  prepare(sql) {
    return new FakeStmt(this, sql)
  }
}

class FakeStmt {
  constructor(db, sql) {
    this.db = db
    this.sql = sql
    this.args = []
  }
  bind(...args) {
    this.args = args
    return this
  }
  async run() {
    if (this.sql.includes("INSERT OR IGNORE")) {
      if (this.db.throwOnInsert) throw new Error("simulated D1 failure")
      const [idempotency_key, install_id, milestone, total_flings, app_version, build, created_at, received_at, ip_hash] =
        this.args
      if (this.db.events.some((e) => e.idempotency_key === idempotency_key)) {
        return { success: true, meta: { changes: 0 } }
      }
      this.db.events.push({
        idempotency_key, install_id, milestone, total_flings,
        app_version, build, created_at, received_at, ip_hash,
      })
      return { success: true, meta: { changes: 1 } }
    }
    return { success: true, meta: { changes: 0 } }
  }
  async first() {
    if (this.sql.includes("WHERE ip_hash = ?")) {
      const [ipHash, sinceISO] = this.args
      const n = this.db.events.filter((e) => e.ip_hash === ipHash && e.received_at > sinceISO).length
      return { n }
    }
    if (this.sql.includes("COUNT(DISTINCT install_id) AS installs") && !this.sql.includes("GROUP BY")) {
      return { installs: new Set(this.db.events.map((e) => e.install_id)).size }
    }
    return null
  }
  async all() {
    if (this.sql.includes("GROUP BY milestone")) {
      const map = new Map()
      for (const e of this.db.events) {
        const m = map.get(e.milestone) || { milestone: e.milestone, events: 0, installs: new Set() }
        m.events++
        m.installs.add(e.install_id)
        map.set(e.milestone, m)
      }
      const results = [...map.values()]
        .map((m) => ({ milestone: m.milestone, events: m.events, installs: m.installs.size }))
        .sort((a, b) => a.milestone - b.milestone)
      return { results, success: true }
    }
    return { results: [], success: true }
  }
}

// --- Helpers -----------------------------------------------------------------
function makeEnv(overrides = {}) {
  return {
    DB: new FakeD1(),
    DISCORD_WEBHOOK: "https://discord.example/webhook",
    STATS_KEY: "s3cret",
    IP_SALT: "salty",
    RATE_LIMIT_PER_HOUR: "200",
    ...overrides,
  }
}

function milestoneRequest(body, { headers = {}, method = "POST" } = {}) {
  const init = {
    method,
    headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.7", ...headers },
  }
  // GET/HEAD requests cannot carry a body (undici enforces this).
  if (method !== "GET" && method !== "HEAD") {
    init.body = typeof body === "string" ? body : JSON.stringify(body)
  }
  return new Request("https://47summers.com/api/fling/milestones", init)
}

function validEvent(over = {}) {
  return {
    schema_version: "1.0",
    event: "fling_milestone",
    idempotency_key: "install-abc:100",
    install_id: "install-abc",
    milestone: 100,
    total_flings: 101,
    app_version: "1.0",
    build: "3",
    created_at: "2026-06-13T07:00:00Z",
    ...over,
  }
}

let fetchMock
beforeEach(() => {
  fetchMock = mock.method(globalThis, "fetch", async () => new Response(null, { status: 204 }))
})
afterEach(() => {
  mock.restoreAll()
})

// --- Happy path --------------------------------------------------------------
test("valid event: stores row, returns 200, fires one alert", async () => {
  const env = makeEnv()
  const res = await handleMilestone(milestoneRequest(validEvent()), env)
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { ok: true, duplicate: false })
  assert.equal(env.DB.events.length, 1)
  assert.equal(fetchMock.mock.calls.length, 1) // Discord alert
  const stored = env.DB.events[0]
  assert.equal(stored.idempotency_key, "install-abc:100")
  assert.equal(stored.install_id, "install-abc")
  assert.equal(stored.milestone, 100)
  assert.equal(stored.created_at, "2026-06-13T07:00:00Z")
  assert.ok(stored.received_at && stored.received_at !== stored.created_at) // server-stamped
  assert.ok(stored.ip_hash && stored.ip_hash.length === 64) // sha-256 hex, not raw IP
})

test("duplicate: returns 2xx, does NOT double-insert, does NOT re-alert", async () => {
  const env = makeEnv()
  await handleMilestone(milestoneRequest(validEvent()), env)
  const res = await handleMilestone(milestoneRequest(validEvent()), env)
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { ok: true, duplicate: true })
  assert.equal(env.DB.events.length, 1)
  assert.equal(fetchMock.mock.calls.length, 1) // still only the first alert
})

test("idempotency_key falls back to the header when absent in the body", async () => {
  const env = makeEnv()
  const body = validEvent()
  delete body.idempotency_key
  await handleMilestone(milestoneRequest(body, { headers: { "idempotency-key": "install-abc:100" } }), env)
  assert.equal(env.DB.events[0].idempotency_key, "install-abc:100")
})

test("all four reached milestones from one install dedupe independently", async () => {
  const env = makeEnv()
  for (const m of [10, 100, 500, 1000]) {
    await handleMilestone(milestoneRequest(validEvent({ milestone: m, idempotency_key: `install-abc:${m}` })), env)
  }
  // resend 100 — should be ignored
  await handleMilestone(milestoneRequest(validEvent({ milestone: 100 })), env)
  assert.equal(env.DB.events.length, 4)
  assert.equal(fetchMock.mock.calls.length, 4)
})

// --- Validation --------------------------------------------------------------
test("non-POST → 405", async () => {
  const res = await handleMilestone(milestoneRequest(validEvent(), { method: "GET" }), makeEnv())
  assert.equal(res.status, 405)
})

test("wrong content-type → 415", async () => {
  const res = await handleMilestone(milestoneRequest(validEvent(), { headers: { "content-type": "text/plain" } }), makeEnv())
  assert.equal(res.status, 415)
})

test("invalid JSON → 400", async () => {
  const res = await handleMilestone(milestoneRequest("{not json", {}), makeEnv())
  assert.equal(res.status, 400)
})

test("wrong event name → 422", async () => {
  const res = await handleMilestone(milestoneRequest(validEvent({ event: "something_else" })), makeEnv())
  assert.equal(res.status, 422)
})

test("milestone not in whitelist → 422", async () => {
  const res = await handleMilestone(milestoneRequest(validEvent({ milestone: 50 })), makeEnv())
  assert.equal(res.status, 422)
})

test("missing install_id → 422", async () => {
  const body = validEvent()
  body.install_id = ""
  const res = await handleMilestone(milestoneRequest(body), makeEnv())
  assert.equal(res.status, 422)
})

test("body over 4KB → 413", async () => {
  const res = await handleMilestone(milestoneRequest(validEvent({ app_version: "x".repeat(5000) })), makeEnv())
  assert.equal(res.status, 413)
})

// --- Reliability -------------------------------------------------------------
test("transient storage error → 503 (so the app retries), no alert", async () => {
  const env = makeEnv()
  env.DB.throwOnInsert = true
  const res = await handleMilestone(milestoneRequest(validEvent()), env)
  assert.equal(res.status, 503)
  assert.equal(fetchMock.mock.calls.length, 0)
})

test("missing Discord webhook: still stores and returns 200, just no alert", async () => {
  const env = makeEnv({ DISCORD_WEBHOOK: undefined })
  const res = await handleMilestone(milestoneRequest(validEvent()), env)
  assert.equal(res.status, 200)
  assert.equal(env.DB.events.length, 1)
  assert.equal(fetchMock.mock.calls.length, 0)
})

test("rate limit: over the per-IP cap → 429", async () => {
  const env = makeEnv({ RATE_LIMIT_PER_HOUR: "2" })
  await handleMilestone(milestoneRequest(validEvent({ install_id: "a", idempotency_key: "a:10", milestone: 10 })), env)
  await handleMilestone(milestoneRequest(validEvent({ install_id: "b", idempotency_key: "b:10", milestone: 10 })), env)
  const res = await handleMilestone(milestoneRequest(validEvent({ install_id: "c", idempotency_key: "c:10", milestone: 10 })), env)
  assert.equal(res.status, 429)
  assert.equal(env.DB.events.length, 2)
})

// --- Stats -------------------------------------------------------------------
test("stats requires the secret key", async () => {
  const env = makeEnv()
  const res = await handleStats(new Request("https://47summers.com/api/fling/stats"), env)
  assert.equal(res.status, 401)
})

test("stats returns per-milestone counts and unique installs", async () => {
  const env = makeEnv()
  await handleMilestone(milestoneRequest(validEvent({ install_id: "a", idempotency_key: "a:10", milestone: 10 })), env)
  await handleMilestone(milestoneRequest(validEvent({ install_id: "b", idempotency_key: "b:10", milestone: 10 })), env)
  await handleMilestone(milestoneRequest(validEvent({ install_id: "a", idempotency_key: "a:100", milestone: 100 })), env)
  const res = await handleStats(new Request("https://47summers.com/api/fling/stats?key=s3cret"), env)
  assert.equal(res.status, 200)
  const data = await res.json()
  assert.equal(data.unique_installs, 2)
  const ten = data.milestones.find((m) => m.milestone === 10)
  assert.equal(ten.events, 2)
  assert.equal(ten.installs, 2)
  const hundred = data.milestones.find((m) => m.milestone === 100)
  assert.equal(hundred.events, 1)
})
