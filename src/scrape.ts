import { parse as parseHtml } from "node-html-parser";
import { findCoach, loadCoaches, parseTeam } from "./coaches.ts";

export type Fixture = {
  id: string;
  source: "gotsport" | "ecnl" | "mlsnext";
  league: "NAL" | "NECSL" | "NEAL" | "N1" | "ECNL" | "MLS";
  leagueLabel: string;
  event: string;
  division: string;
  date: string;          // YYYY-MM-DD (US/Eastern)
  time: string;          // "3:00 PM" or "" when TBD
  sortKey: string;       // date + time for sorting
  home: string;
  away: string;
  homeScore: number | null;
  awayScore: number | null;
  status: string;        // Scheduled | Played | Postponed | Cancelled | TBD
  venue: string;
  surfTeam: string;
  opponent: string;
  isHome: boolean;
  result: "W" | "D" | "L" | "";
  gender: string;
  age: number | null;
  tier: string;
  region: string;
  coach: string;
  url: string;
  src?: string;          // scrape task name (used to keep stale data when a source fails)
};

export type Snapshot = {
  updatedAt: string;
  fixtures: Fixture[];
  sources: { name: string; ok: boolean; count: number; error?: string; note?: string; ms: number }[];
  gotsportCapturedAt?: string;
  coaches: { source: string; asOf: string; count: number };
};

const CLUB_RE = /New England Surf|NE Surf/i;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

// ---------- configuration (override with env vars without redeploying code) ----------
type GsEvent = { id: number; league: Fixture["league"]; label: string };
const DEFAULT_GOTSPORT: GsEvent[] = [
  { id: 55967, league: "NAL", label: "National Academy League 2026-27" },
  { id: 55964, league: "NECSL", label: "NECSL Fall 2026" },
  { id: 56083, league: "NEAL", label: "Northeast Academy League 2026-27" },
  { id: 54245, league: "N1", label: "N1 Northeast District 1" },
];
const GOTSPORT_CLUB_ID = 7671;
const ECNL_EVENT = 4310; // ECNL RL Girls Northeast 2026-27
const ECNL_TEAL_FLIGHTS: Record<string, number> = { GU13: 41761, GU14: 41762, GU15: 41763, GU16: 41764, GU17: 41765, "GU18/19": 41766 };
const MLS_TEAMS = ["u13", "u14", "u15", "u16", "u17", "u19"].map(a => `new-england-surf-sc-${a}`);

function gotsportEvents(): GsEvent[] {
  const extra = Netlify.env.get("GOTSPORT_EVENTS"); // e.g. "57001:NECSL:NECSL Spring 2027,57002:NAL:..."
  const list = [...DEFAULT_GOTSPORT];
  if (extra) for (const part of extra.split(",")) {
    const [id, league, ...label] = part.split(":");
    if (+id) list.push({ id: +id, league: (league as Fixture["league"]) || "NECSL", label: label.join(":") || `GotSport ${id}` });
  }
  return list;
}

// ---------- helpers ----------
const MONTHS: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
function toIsoDate(s: string): string {
  const m = s.match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (!m) return "";
  return `${m[3]}-${MONTHS[m[1].toLowerCase()] || "01"}-${m[2].padStart(2, "0")}`;
}
function normTime(s: string): string {
  const m = s.match(/(\d{1,2}):(\d{2})\s*([AP]M)/i);
  return m ? `${+m[1]}:${m[2]} ${m[3].toUpperCase()}` : "";
}
function time24(t: string): string {
  const m = t.match(/(\d{1,2}):(\d{2}) ([AP]M)/);
  if (!m) return "99:99";
  let h = +m[1] % 12; if (m[3] === "PM") h += 12;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}
function clean(s: string) { return s.replace(/\s+/g, " ").trim(); }

function finish(f: Omit<Fixture, "sortKey" | "surfTeam" | "opponent" | "isHome" | "result" | "gender" | "age" | "tier" | "region" | "coach">, coachRows: Awaited<ReturnType<typeof loadCoaches>>["rows"]): Fixture | null {
  const homeIsSurf = CLUB_RE.test(f.home), awayIsSurf = CLUB_RE.test(f.away);
  if (!homeIsSurf && !awayIsSurf) return null;
  const isHome = homeIsSurf; // Surf vs Surf: treat home side as "our" team
  const surfTeam = isHome ? f.home : f.away;
  const opponent = isHome ? f.away : f.home;
  let result: Fixture["result"] = "";
  if (f.homeScore != null && f.awayScore != null) {
    const us = isHome ? f.homeScore : f.awayScore, them = isHome ? f.awayScore : f.homeScore;
    result = us > them ? "W" : us < them ? "L" : "D";
  }
  const key = parseTeam(surfTeam, f.league, f.division);
  const coach = findCoach(key, coachRows);
  return { ...f, sortKey: `${f.date} ${time24(f.time)}`, surfTeam, opponent, isHome, result, gender: key.gender, age: key.age, tier: key.tier, region: key.region, coach };
}

async function get(url: string, headers: Record<string, string> = {}) {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,application/json;q=0.9,*/*;q=0.8", "accept-language": "en-US,en;q=0.9", ...headers }, signal: AbortSignal.timeout(20000), redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (res.url && res.url !== url) console.warn(`[get] redirected ${url} -> ${res.url}`);
  return res.text();
}

// ---------- GotSport ----------
// GotSport serves a CAPTCHA page to datacenter IPs, so the live fetch usually fails from CI.
// Fallback: rows captured from a real browser session and committed to data/gotsport-raw.json
// (shape: { fetchedAt, events: { [eventId]: string[][] } }, each row = the 7 schedule columns).
import gotsportRaw from "../data/gotsport-raw.json" with { type: "json" };
export const GOTSPORT_CAPTURED_AT: string = (gotsportRaw as any).fetchedAt || "";

function gotsportRowsToFixtures(ev: GsEvent, rows: string[][], coachRows: any, baseUrl: string): Fixture[] {
  const out: Fixture[] = [];
  for (const r of rows) {
    if (r.length < 7) continue;
    const [matchNo, timeCell, home, resTxt, away, venue, division] = r.map(clean);
    const date = toIsoDate(timeCell);
    const time = normTime(timeCell);
    let status = "Scheduled";
    if (/postponed/i.test(timeCell)) status = "Postponed";
    else if (/cancel/i.test(timeCell)) status = "Cancelled";
    else if (!time) status = "TBD";
    let hs: number | null = null, as: number | null = null;
    const sm = resTxt.match(/(\d+)\s*-\s*(\d+)/);
    if (sm) { hs = +sm[1]; as = +sm[2]; if (status === "Scheduled") status = "Played"; }
    const f = finish({
      id: `gs-${ev.id}-${matchNo}`, source: "gotsport", league: ev.league, leagueLabel: ev.label, event: ev.label, division,
      date, time, home, away, homeScore: hs, awayScore: as, status, venue, url: baseUrl,
    }, coachRows);
    if (f) out.push(f);
  }
  return out;
}

async function scrapeGotsport(ev: GsEvent, coachRows: any) {
  const url = `https://system.gotsport.com/org_event/events/${ev.id}/schedules?club=${GOTSPORT_CLUB_ID}`;
  let live: string[][] = [];
  let liveErr = "";
  try {
    const html = await get(url);
    const root = parseHtml(html);
    // raw HTML has no <tbody>; match any table row with the 7 schedule columns
    live = root.querySelectorAll("table tr").filter(tr => tr.querySelectorAll("td").length >= 7)
      .map(tr => tr.querySelectorAll("td").map(td => clean(td.text)));
    if (!live.length) liveErr = /verify_captchas|Please verify/i.test(html) ? "GotSport CAPTCHA" : "no schedule rows";
  } catch (e) { liveErr = (e as Error).message; }
  if (live.length) return gotsportRowsToFixtures(ev, live, coachRows, url);

  const captured: string[][] = ((gotsportRaw as any).events || {})[String(ev.id)] || [];
  if (!captured.length) throw new Error(`${liveErr}; no captured rows for event ${ev.id}`);
  console.warn(`[gotsport ${ev.id}] live fetch failed (${liveErr}); using ${captured.length} rows captured ${GOTSPORT_CAPTURED_AT}`);
  const fx = gotsportRowsToFixtures(ev, captured, coachRows, url);
  (fx as any).__note = `captured ${GOTSPORT_CAPTURED_AT.slice(0, 10)}`;
  return fx;
}

// ---------- ECNL RL (TGS / AthleteOne) ----------
async function scrapeEcnl(ageLabel: string, flightId: number, coachRows: any) {
  const url = `https://api.athleteone.com/api/Script/get-conference-schedules/13/82/${ECNL_EVENT}/${flightId}/0`;
  const html = await get(url, { referer: "https://theecnl.com/", origin: "https://theecnl.com" });
  const root = parseHtml(html);
  const out: Fixture[] = [];
  for (const tr of root.querySelectorAll("tr")) {
    const tds = tr.querySelectorAll("td");
    if (tds.length < 4) continue;
    const matchNo = clean(tds[0].text);
    const info = tds[1].querySelectorAll("div").map(d => clean(d.text));
    const date = toIsoDate(info[0] || ""), time = normTime(info[1] || ""), division = info[2] || `${ageLabel} - Teal`;
    const teams = tds[2].querySelectorAll(".individual-team-item").map(s => clean(s.text));
    const venue = clean(tds[2].querySelector(".game-complex-item")?.text || "");
    const scores = tds[3].querySelectorAll("div").map(d => clean(d.text)).filter(t => /^\d+$/.test(t));
    const hs = scores.length >= 2 ? +scores[0] : null, as = scores.length >= 2 ? +scores[1] : null;
    const status = hs != null ? "Played" : time ? "Scheduled" : "TBD";
    const f = finish({
      id: `ecnl-${matchNo}`, source: "ecnl", league: "ECNL", leagueLabel: "ECNL RL Girls Northeast – Teal", event: "ECNL RL Girls Northeast 2026-27", division,
      date, time, home: teams[0] || "", away: teams[1] || "", homeScore: hs, awayScore: as, status, venue,
      url: "https://theecnl.com/sports/2023/8/8/ECNLRLG_0808235356.aspx",
    }, coachRows);
    if (f) out.push(f);
  }
  return out;
}

// ---------- MLS NEXT (mlsnexttracker.com) ----------
async function scrapeMls(slug: string, coachRows: any) {
  const url = `https://mlsnexttracker.com/api/standings?team=${slug}&division=academy`;
  const j = JSON.parse(await get(url, { referer: `https://mlsnexttracker.com/academy/${slug}` }));
  const tz = "America/New_York";
  const out: Fixture[] = [];
  const age = (j.team?.ageGroup || slug.split("-").pop() || "").toUpperCase();
  for (const g of j.schedule || []) {
    const d = new Date(g.startTime);
    const dateStr = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
    const timeStr = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(d);
    const hs = g.homeScore ?? null, as = g.awayScore ?? null;
    const f = finish({
      id: `mls-${g.id}`, source: "mlsnext", league: "MLS", leagueLabel: "MLS NEXT Academy", event: "MLS NEXT Academy Division 2026-27", division: `${age} ${j.team?.conference || ""}`.trim(),
      date: dateStr, time: timeStr, home: `${g.home} ${age}`, away: `${g.away} ${age}`, homeScore: hs, awayScore: as,
      status: g.completed ? "Played" : "Scheduled", venue: g.location || "",
      url: `https://mlsnexttracker.com/academy/${slug}`,
    }, coachRows);
    if (f) { f.home = g.home; f.away = g.away; f.surfTeam = `New England Surf SC ${age} (MLS NEXT)`; f.opponent = f.isHome ? g.away : g.home; out.push(f); }
  }
  return out;
}

// ---------- orchestrator ----------
export async function buildSnapshot(previous?: Snapshot | null): Promise<Snapshot> {
  const coaches = await loadCoaches();
  const tasks: { name: string; run: () => Promise<Fixture[]> }[] = [
    ...gotsportEvents().map(ev => ({ name: `GotSport ${ev.label}`, run: () => scrapeGotsport(ev, coaches.rows) })),
    ...Object.entries(ECNL_TEAL_FLIGHTS).map(([age, id]) => ({ name: `ECNL RL ${age} Teal`, run: () => scrapeEcnl(age, id, coaches.rows) })),
    ...MLS_TEAMS.map(slug => ({ name: `MLS NEXT ${slug.split("-").pop()!.toUpperCase()}`, run: () => scrapeMls(slug, coaches.rows) })),
  ];
  const results = await Promise.all(tasks.map(async t => {
    const t0 = Date.now();
    try { const fx = await t.run(); fx.forEach(f => (f.src = t.name)); return { name: t.name, ok: true, count: fx.length, ms: Date.now() - t0, fixtures: fx, note: (fx as any).__note as string | undefined }; }
    catch (e) {
      // keep the last good data for this source so one bad fetch never blanks the page
      const stale = (previous?.fixtures || []).filter(f => f.src === t.name);
      return { name: t.name, ok: false, count: stale.length, error: `${(e as Error).message}${stale.length ? " (showing last good data)" : ""}`, ms: Date.now() - t0, fixtures: stale };
    }
  }));
  const seen = new Set<string>();
  const fixtures = results.flatMap(r => r.fixtures).filter(f => (seen.has(f.id) ? false : (seen.add(f.id), true)))
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  return {
    updatedAt: new Date().toISOString(),
    fixtures,
    sources: results.map(({ fixtures: _f, ...r }) => r),
    gotsportCapturedAt: GOTSPORT_CAPTURED_AT,
    coaches: { source: coaches.source, asOf: coaches.asOf, count: coaches.rows.length },
  };
}
