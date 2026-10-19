import type { Config, Context } from "@netlify/functions";
import { readSnapshot, refreshSnapshot } from "../../src/store.ts";

const MIN_REFRESH_GAP_MS = 5 * 60 * 1000;

export default async (req: Request, context: Context) => {
  const url = new URL(req.url);
  const route = context.params.route || "fixtures";

  if (route === "refresh") {
    const token = Netlify.env.get("REFRESH_TOKEN");
    if (token && url.searchParams.get("token") !== token) return Response.json({ error: "unauthorized" }, { status: 401 });
    const prev = await readSnapshot();
    const force = url.searchParams.get("force") === "1";
    if (!force && prev && Date.now() - Date.parse(prev.updatedAt) < MIN_REFRESH_GAP_MS) {
      return Response.json({ skipped: true, reason: "refreshed less than 5 minutes ago", updatedAt: prev.updatedAt, sources: prev.sources });
    }
    const snap = await refreshSnapshot();
    return Response.json({ updatedAt: snap.updatedAt, count: snap.fixtures.length, sources: snap.sources, coaches: snap.coaches });
  }

  // default: fixtures
  let snap = await readSnapshot();
  if (!snap) snap = await refreshSnapshot(); // first ever request builds the cache
  return new Response(JSON.stringify(snap), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=60, stale-while-revalidate=300" },
  });
};

export const config: Config = { path: ["/api", "/api/:route"] };
