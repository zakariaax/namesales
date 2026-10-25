/**
 * Later milestones. Mount new handlers next to the routes in index.ts
 * and keep new SQL in migrations with the next numeric prefix.
 *
 * Top sales and last-N-days feeds already exist (`/api/feeds/top` and
 * `/api/feeds/recent`) because range estimates have to stay out of them
 * unless the caller opts in.
 */
export const laterMilestones = [
  "GET /api/stats/keywords",
  "GET /api/stats/extensions",
  "GET /api/reports/daily",
  "GET /api/reports/monthly",
  "GET /api/search.csv",
  "GET /api/saved-searches",
  "GET /api/watchlists",
] as const;
