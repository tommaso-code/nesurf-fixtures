import { getStore } from "@netlify/blobs";
import { buildSnapshot, type Snapshot } from "./scrape.ts";

const KEY = "fixtures.json";
const store = () => getStore({ name: "surf-fixtures", consistency: "strong" });

export async function readSnapshot(): Promise<Snapshot | null> {
  try { return (await store().get(KEY, { type: "json" })) as Snapshot | null; }
  catch (e) { console.warn("blob read failed", (e as Error).message); return null; }
}

export async function refreshSnapshot(): Promise<Snapshot> {
  const prev = await readSnapshot();
  const snap = await buildSnapshot(prev);
  await store().setJSON(KEY, snap);
  return snap;
}
