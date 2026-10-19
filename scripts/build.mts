// Scrapes all sources and writes public/data/fixtures.json (used by the GitHub Pages deployment).
// Run: node --experimental-strip-types scripts/build.mts
import { mkdir, writeFile } from "node:fs/promises";

// Shim the Netlify global so the shared scraper works outside Netlify Functions.
(globalThis as any).Netlify ||= { env: { get: (k: string) => process.env[k] } };

const { buildSnapshot } = await import("../src/scrape.ts");

const PREVIOUS_URL = process.env.PREVIOUS_SNAPSHOT_URL || "";
let previous = null;
if (PREVIOUS_URL) {
  try {
    const r = await fetch(PREVIOUS_URL, { signal: AbortSignal.timeout(15000), cache: "no-store" } as any);
    if (r.ok) previous = await r.json();
  } catch (e) { console.warn("no previous snapshot:", (e as Error).message); }
}

const snap = await buildSnapshot(previous);
await mkdir("public/data", { recursive: true });
await writeFile("public/data/fixtures.json", JSON.stringify(snap));

console.log(`fixtures: ${snap.fixtures.length}`);
for (const s of snap.sources) console.log(`${s.ok ? "✓" : "✗"} ${s.name}: ${s.count}${s.error ? " — " + s.error : ""} (${s.ms}ms)`);
const failed = snap.sources.filter(s => !s.ok);
if (failed.length === snap.sources.length) { console.error("every source failed — aborting so the live site keeps its data"); process.exit(1); }
