import { COACHES_RAW, COACHES_SNAPSHOT_AT } from "./coaches-data.ts";

export type CoachRow = {
  sheet: string; age: string; birth: string; region: string; gender: string;
  tier: string; league: string; leagueTier: string; placement: string; coach: string;
  ages: number[];
};

export type TeamKey = {
  gender: "Boys" | "Girls" | "";
  age: number | null;
  tier: string;      // Navy | Sky | Royal | ""
  region: string;    // State | Charlestown | Metro Boston | ...
  league: string;    // ECNL | MLS | NAL | N1 | NECSL | NEAL
};

const SEASON_START_YEAR = 2026; // 2026-27 season: U = 2026 - birthYear

function expandAges(label: string): number[] {
  const out = new Set<number>();
  const m = label.match(/U(\d+)\s*-\s*U(\d+)/i);
  if (m) { for (let i = +m[1]; i <= +m[2]; i++) out.add(i); return [...out]; }
  for (const p of label.split(/[\/,]/)) {
    const n = p.match(/(\d+)/);
    if (n) out.add(+n[1]);
  }
  return [...out];
}

export function parseCoachRows(raw: string): CoachRow[] {
  return raw.split("\n").map(l => l.trim()).filter(Boolean).map(l => {
    const [sheet, age, birth, region, gender, tier, league, leagueTier, placement, coach] = l.split("|").map(s => (s || "").trim());
    return { sheet, age, birth, region, gender, tier, league, leagueTier, placement, coach, ages: expandAges(age) };
  }).filter(r => r.coach && r.coach !== "TBD");
}

// Optional live refresh from a CSV export of the sheet (requires the sheet to be link-viewable).
// Expected columns match the directory tabs: col0 age, col1 birth year, col2 region, col3 gender,
// col4 tier, col6 league, col7 league tier, col8 NECSL placement, col11 full name.
function parseCsv(t: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], f = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n") { row.push(f); rows.push(row); row = []; f = ""; }
    else if (c !== "\r") f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}

export async function loadCoaches(): Promise<{ rows: CoachRow[]; source: string; asOf: string }> {
  const urls = (Netlify.env.get("COACHES_CSV_URLS") || "").split(",").map(s => s.trim()).filter(Boolean);
  if (urls.length) {
    try {
      const lines: string[] = [];
      for (const u of urls) {
        const res = await fetch(u, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) throw new Error(`coaches csv ${res.status}`);
        const rows = parseCsv(await res.text());
        const sheet = /State\+?Boys|State%20Boys/i.test(u) ? "S" : /State/i.test(u) ? "S" : "R";
        for (const r of rows.slice(1)) {
          if (!r[11] || !/^U\d+/.test((r[0] || "").trim())) continue;
          lines.push([sheet, r[0], r[1], r[2], r[3], r[4], r[6], r[7], r[8], r[11]].map(x => (x || "").trim()).join("|"));
        }
      }
      if (lines.length > 20) return { rows: parseCoachRows(lines.join("\n")), source: "google-sheet", asOf: new Date().toISOString() };
    } catch (e) {
      console.warn("coaches live fetch failed, using snapshot:", (e as Error).message);
    }
  }
  return { rows: parseCoachRows(COACHES_RAW), source: "snapshot", asOf: COACHES_SNAPSHOT_AT };
}

const REGIONS = ["Charlestown", "Metro Boston", "Metro South", "Metro West", "South Shore", "East Boston", "City", "Metro"];

export function parseTeam(name: string, league: string, divisionHint = ""): TeamKey {
  const n = name.replace(/\s+/g, " ");
  let gender: TeamKey["gender"] = "";
  if (/\bGirls\b|\bGU\d|\bG20\d\d|\bU\d+G\b/i.test(n) || /\bGU\d/i.test(divisionHint)) gender = "Girls";
  else if (/\bBoys\b|\bBU\d|\bB20\d\d|\bU\d+B\b/i.test(n) || /\bBU\d/i.test(divisionHint)) gender = "Boys";
  if (!gender && league === "ECNL") gender = "Girls";
  if (!gender && league === "MLS") gender = "Boys";

  let age: number | null = null;
  const u = n.match(/U(\d{1,2})\b/i) || divisionHint.match(/U(\d{1,2})\b/i);
  if (u) age = +u[1];
  else {
    const by = n.match(/[GB](20\d\d)/);
    if (by) age = SEASON_START_YEAR - +by[1];
  }
  if (age === 18) age = 19;

  let tier = (n.match(/\b(Navy|Sky|Royal)\b/i) || [])[1] || "";
  tier = tier ? tier[0].toUpperCase() + tier.slice(1).toLowerCase() : "";
  if (!tier) {
    if (league === "ECNL" || league === "MLS" || league === "NEAL") tier = "Navy";
    else if (league === "NAL") tier = "Sky";
    else if (league === "N1") tier = "Royal";
  }

  let region = "State";
  for (const r of REGIONS) if (new RegExp(`\\b${r}\\b`, "i").test(n)) { region = r; break; }
  if (/\bState\b/i.test(n)) region = "State";
  if (region === "State" && league === "NECSL" && !/\bState\b/i.test(n) && !/\b(Pre-MLS|Academy)\b/i.test(n) && region === "State") {
    // NECSL teams without an explicit region and without "State" are usually regional "Metro" teams
    if (/\bMetro\b/i.test(n)) region = "Metro";
  }
  return { gender, age, tier, region, league };
}

const LEAGUE_MATCH: Record<string, RegExp> = {
  ECNL: /ECNL/i, MLS: /MLS/i, NAL: /\bNAL\b/i, N1: /\bN1\b/i, NEAL: /NEAL/i, NECSL: /NECSL|NESCSL/i,
};

export function findCoach(key: TeamKey, rows: CoachRow[]): string {
  if (!key.gender || key.age == null) return "";
  // Regional teams: only match within a region the directory actually lists (avoids guessing for e.g. East Boston)
  if (key.region !== "State") {
    const stem = key.region.toLowerCase().split(" ")[0];
    if (!rows.some(r => r.region.toLowerCase().includes(stem))) return "";
  }
  let best: CoachRow[] = []; let bestScore = -1;
  for (const r of rows) {
    if (r.gender !== key.gender) continue;
    if (!r.ages.includes(key.age)) continue;
    if (r.ages.length > 4 || /\bGK\b/i.test(r.tier)) continue; // skip club-wide / goalkeeper rows
    let s = 0;
    const rTier = r.tier.toLowerCase();
    if (key.tier && rTier.includes(key.tier.toLowerCase())) s += 3;
    else if (key.tier && rTier && !/pool|gk/.test(rTier)) s -= 2;
    if (key.region === "State") { if (r.region === "State") s += 3; else s -= 3; }
    else {
      if (r.region.toLowerCase() === key.region.toLowerCase()) s += 3;
      else if (r.region.toLowerCase().includes(key.region.toLowerCase().split(" ")[0])) s += 1;
      else if (r.region === "State") s -= 3;
    }
    const lm = LEAGUE_MATCH[key.league];
    if (lm && lm.test(r.league)) s += 2;
    if (r.age.includes("/") || r.age.includes("-")) s -= 0.5; // prefer exact age rows
    if (s > bestScore) { bestScore = s; best = [r]; }
    else if (s === bestScore) best.push(r);
  }
  if (bestScore < 2) return "";
  return [...new Set(best.map(b => b.coach))].join(" / ");
}
