# Fling milestone receiver (Cloudflare Worker)

Catches the anonymous milestone events the Fling iOS app already sends
(`POST https://47summers.com/api/fling/milestones`) and stores them in a small
database, so you can later count early users and — if you ever choose to —
grandfather them into Plus. It also pings Discord whenever an install crosses
10 / 100 / 500 / 1000 Flings.

**What it touches:** only the `/api/fling/*` path on 47summers.com. Your static
landing site keeps serving from GitHub Pages, untouched — this Worker never even
runs for it.

**Cost:** $0/month (Cloudflare free plan).

---

## Setup runbook

You only have to do **Part 1** by hand (the browser/DNS steps). After that, run
the one login command in Part 2 and Claude can do the rest from the terminal.

### Part 1 — Put the domain on Cloudflare (you, ~15 min + a wait)

The receiver needs Cloudflare to sit in front of the domain. Today the domain's
DNS lives at Namecheap, so we point it at Cloudflare. The site stays up the whole
time.

1. **Add the site to Cloudflare.** Go to dash.cloudflare.com → *Add a site* →
   enter `47summers.com` → choose the **Free** plan.
2. **Let Cloudflare import your records.** It scans existing DNS and lists them.
   Confirm you see four `A` records for `47summers.com` pointing at
   `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   (those are GitHub Pages). If any are missing, add them. Make sure each is
   **Proxied** (orange cloud ON) — this is what lets the Worker intercept the API
   path while everything else flows through to GitHub Pages.
3. **Copy the two nameservers** Cloudflare shows you (they look like
   `xxx.ns.cloudflare.com`).
4. **Switch nameservers at Namecheap.** Namecheap → *Domain List* → `47summers.com`
   → *Manage* → *Nameservers* → choose **Custom DNS** → paste the two Cloudflare
   nameservers → save.
5. **Wait for activation.** Cloudflare emails you when the domain is active
   (usually minutes, up to a few hours). When done, open
   `https://47summers.com` and confirm the landing page still loads normally.

> Tell Claude once this is active — then Part 2 takes a few minutes.

### Part 2 — Deploy the Worker

```bash
cd worker
npm install
npx wrangler login        # opens a browser once to authorize your Cloudflare account
```

Then Claude (or you) runs:

```bash
# 1. Create the database, then paste the printed database_id into wrangler.toml
npx wrangler d1 create fling-milestones

# 2. Create the table
npm run migrate

# 3. Set the three secrets (you'll be prompted to paste each value)
npx wrangler secret put DISCORD_WEBHOOK   # a Discord channel webhook URL (see below)
npx wrangler secret put STATS_KEY         # any long random string — your stats password
npx wrangler secret put IP_SALT           # any long random string

# 4. Ship it
npm run deploy
```

**Discord webhook:** in Discord, pick a channel → *Edit Channel* → *Integrations*
→ *Webhooks* → *New Webhook* → *Copy Webhook URL*. Paste that as `DISCORD_WEBHOOK`.

**Random strings** for `STATS_KEY` / `IP_SALT`: run `openssl rand -hex 24`.

### Part 3 — Verify (Claude does this)

```bash
# Should print {"ok":true,"duplicate":false}
curl -sS -X POST https://47summers.com/api/fling/milestones \
  -H 'content-type: application/json' \
  -H 'idempotency-key: test-install:10' \
  -d '{"schema_version":"1.0","event":"fling_milestone","idempotency_key":"test-install:10","install_id":"test-install","milestone":10,"total_flings":11,"app_version":"1.0","build":"3","created_at":"2026-06-14T12:00:00Z"}'

# Run it again → {"ok":true,"duplicate":true}  (and NO second Discord ping)

# See your numbers (use your STATS_KEY)
curl -sS "https://47summers.com/api/fling/stats?key=YOUR_STATS_KEY"
```

You should also get a Discord ping on the first call. Delete the `test-install`
row afterward if you like:
```bash
npx wrangler d1 execute fling-milestones --remote \
  --command "DELETE FROM milestone_events WHERE install_id='test-install'"
```

---

## Checking on it later

- **Discord:** you get a ping every time an install crosses a milestone.
- **Stats anytime:** `https://47summers.com/api/fling/stats?key=YOUR_STATS_KEY`
- **Raw queries:** Cloudflare dashboard → Workers & Pages → D1 → `fling-milestones`
  → Console, or via the CLI.

### Grandfather query (only if you ever decide to credit early users)

"Which installs had crossed 100 Flings before a cutoff date" — use the
**server** timestamp `received_at`, never the client's `created_at`:

```sql
SELECT DISTINCT install_id
FROM milestone_events
WHERE milestone >= 100 AND received_at < '2026-09-01';
```

This is recorded from day one, so the option stays open even though nobody is
grandfathered automatically. (Crediting would still need a future app change to
tie an install to a Plus unlock — see the plan in the swish repo.)

---

## Development

```bash
npm test          # contract tests (no Cloudflare account needed)
npm run dev       # local Worker + local D1
```

The wire contract this implements is pinned in the app code; see
`launch/milestone-telemetry.md` in the swish (Fling) repo.
