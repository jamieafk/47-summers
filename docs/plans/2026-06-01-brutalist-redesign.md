# Brutalist Redesign Implementation Plan

**Goal:** Replace the Craigslist-minimal look of 47summers.com with the neo-brutalist design from the Magic Patterns mockup, while keeping the site zero-build and zero-dependency.

**Architecture:** Plain static HTML + one shared `style.css`. No React/Tailwind/router/build step. Native `<details>` for collapsibles (no JS). Deploys to GitHub Pages unchanged. One `.html` file per product preserved for Apple privacy-policy URLs.

**Tech Stack:** HTML5, one hand-written CSS file. Block ASCII headers via figlet "ANSI Shadow" font.

**Design language:** 8px black borders, black/white/yellow (`#fde047`) palette, uppercase font-900 sans headings, monospace body, hover-invert cards, ASCII in inverted black boxes. Privacy-policy body stays sentence-case for readability; headings/labels uppercase.

---

### Task 1: Design system

**Files:** Create `style.css`

- [ ] Reset + base (border-box, margins, body mono, fluid type via clamp)
- [ ] `.box` / `.box--invert` / `.rule` / `.badge` primitives
- [ ] `.cards` + `.card` stacked-border + hover/focus invert
- [ ] `.email` yellow contact block
- [ ] `<details>`/`<summary>` brutalist bar with ▼/▲ marker, no JS
- [ ] Responsive: ASCII overflow-x, type scales down on mobile

### Task 2: Home

**Files:** Rewrite `index.html`

- [ ] Block ASCII "47 SUMMERS" hero, intro invert box
- [ ] Portfolio cards: Sling (→sling.html), Asoona (→asoona.html), Sally Sold (→sallysold.com), Myrtle (no link, unchanged copy)
- [ ] Yellow contact box (email obfuscated), invert footer

### Task 3: Product pages

**Files:** Rewrite `sling.html`, `asoona.html`, `sally-sold.html`

- [ ] Block ASCII header per product, brutalist title box
- [ ] Sling: Support/FAQ section + full privacy policy (verbatim from source)
- [ ] Asoona / Sally Sold: privacy policy verbatim, mailto links preserved

### Task 4: Rules + ship

**Files:** Modify `CLAUDE.md`

- [ ] Rewrite "zero CSS/JS" rule → "styled, zero-build / zero-dependency"; update Decisions
- [ ] Visual validation (screenshot all pages), then commit + push live
