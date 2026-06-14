// Fling milestone receiver — Worker entry point.
// Only /api/fling/* reaches this Worker (see wrangler.toml routes).

import { handleMilestone, handleStats } from "./receiver.js"
import { json } from "./http.js"

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url)
    switch (pathname) {
      case "/api/fling/milestones":
        return handleMilestone(request, env, ctx)
      case "/api/fling/stats":
        return handleStats(request, env)
      default:
        return json({ error: "not_found" }, 404)
    }
  },
}
