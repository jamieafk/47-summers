# 47 Summers

Landing page for 47 Summers LLC. GitHub Pages at `47summers.com` (CNAME).

## Rules

- **Zero build, zero deps, zero JS.** Static HTML + one shared `style.css`, deployed to GitHub Pages as-is. Exception: `worker/` (edge infra, see Structure).
- **All styling in `style.css`.** No `<style>` blocks, no per-page CSS.
- **Collapsibles = native `<details>`/`<summary>`**, never JS.
- Semantic HTML with design-system classes (`.box`, `.box--invert`, `.card`, `.badge`, `.rule`, `.email`, `.details-body`, `.qa`, `.note-yellow`, `.code-block`).
- "47 Summers" in headings/copy; "47 Summers LLC" only in footer copyright and privacy policies.

## Structure

- `style.css` — single source of visual truth, linked by every page
- `index.html` — home: ASCII hero, intro, portfolio cards, contact, footer
- `{product}.html` — one page per product (`fling`, `games-for-grandparents`, `sally-sold`, `asoona`), each with a `<details>` privacy policy for that app
- `sling.html` — redirect stub to `fling.html` (Sling renamed Fling); keep it, don't copy from it
- `worker/` — Cloudflare Worker: anonymous Fling milestone events at `47summers.com/api/fling/*` → D1. The one dynamic piece; intercepts only the API path. Own `package.json`/tests, deployed via `wrangler`, not Pages. Runbook: `worker/README.md`. Plan: `../swish/docs/plans/2026-06-14-fling-paid-model.md`.

## Design language (brutalist)

- 8px black borders; black/white/yellow (`#fde047`)
- Uppercase Arial-900 headings, monospace body. Privacy-policy *body* stays sentence-case
- Hover/focus-invert cards; ASCII art in inverted black boxes
- Readability: prose capped at 68ch with 1.65 leading; inline `<code>` gets a tinted chip; Q&A pairs split by a full-width rule (no side-stripe borders)
- ASCII headers: figlet **"ANSI Shadow"** (`figlet -d /tmp -f "ANSI Shadow" "NAME"`; font at `/tmp/ANSI Shadow.flf`, from github.com/xero/figlet-fonts)
- Responsive: box padding tightens under 48rem; `.ascii` scales via `clamp()` so the widest banner fits on phones

## Adding a new product

1. Copy `fling.html` → `{product}.html`; swap ASCII header, description, privacy policy
2. Add a `.card` `<li>` with platform `.badge` to the Portfolio list in `index.html`
3. App Store Connect privacy URL: `https://47summers.com/{product}.html`

## Decisions

- **Zero build / zero deps** — too simple to justify tooling; one CSS file deploys unchanged.
- **One shared `style.css`** — replaced "browser defaults, zero CSS" at the 2026-06-01 brutalist redesign (`docs/plans/`); edits in one place.
- **One HTML file per product** — each app needs its own privacy-policy URL for App Store Connect; no anchor-link fragility, adding a product is a copy.
- **`<details>` for privacy policies** — policy lives on the product page (single URL for Apple), no clutter, no JS.

## Privacy policy requirements (Apple)

Cover: data collected, how used, sharing, retention/deletion, children's privacy, change notification, contact. Name the specific app; no generic policies.
