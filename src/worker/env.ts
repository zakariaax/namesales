export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Set with `npx wrangler secret put ADMIN_KEY`. Unset keys cannot force a stats rebuild. */
  ADMIN_KEY?: string;
}
