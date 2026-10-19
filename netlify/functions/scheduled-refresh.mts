import type { Config } from "@netlify/functions";
import { refreshSnapshot } from "../../src/store.ts";

// Runs every hour on the hour (UTC). Scheduled functions have a 30s limit; all sources are fetched in parallel.
export default async () => {
  const snap = await refreshSnapshot();
  console.log(`refreshed ${snap.fixtures.length} fixtures;`, snap.sources.map(s => `${s.name}: ${s.ok ? s.count : "FAIL " + s.error}`).join(" | "));
};

export const config: Config = { schedule: "0 * * * *" };
