// Offline parser test with captured HTML/JSON samples. Run: node --experimental-strip-types test/parse.test.mts
(globalThis as any).Netlify = { env: { get: () => undefined } };

const GS = `<table>
<tr class="fz-sm"> <td> 9989 </td> <td width="9%"> Sep 12, 2026 <div class="text-color"> 3:00PM EDT EDT</div> <br> <label class="label label-default"></label> </td> <td class=""> <img> <a href="/org_event/events/55967/schedules?team=4151686">IFA South Shore U13 Girls NAL</a> </td> <td class="text-center"> <a href="/org_event/events/55967/schedules?group=518871&amp;match=26219066">2 - 0</a> </td> <td class=""> <img> <a href="/org_event/events/55967/schedules?team=4142060">New England Surf GU13 State Sky</a> </td> <td> <ul> <li><a href="/org_event/events/55967/schedules?pitch=14465">Cohasset Sports Complex - Cohasset Sports Complex 1</a></li> </ul> </td> <td> <a href="/org_event/events/55967/schedules?group=518871">New England GU13</a> </td> </tr>
<tr class="fz-sm"> <td> 6041 </td> <td width="9%"> May 22, 2027 <div class="text-color"></div> </td> <td> <a>Seacoast United Massachusetts U17 Boys NAL</a> </td> <td class="text-center"> - </td> <td> <a>New England Surf U17B State Sky</a> </td> <td> </td> <td> <a>New England BU17</a> </td> </tr>
<tr class="fz-sm"> <td> 104 </td> <td width="9%"> Sep 27, 2026 <div class="text-color"> 3:00 PM EDT Postponed</div> </td> <td> <a>Select N1 B2012/2013 South Shore (MA)</a> </td> <td class="text-center"> - </td> <td> <a>New England Surf N1 B2012/13 State Royal (MA)</a> </td> <td> <ul><li>Somewhere - 1</li></ul> </td> <td> <a>14B Premier 2</a> </td> </tr>
<tr class="fz-sm"> <td> 1 </td> <td> Oct 25, 2026 <div class="text-color"> 9:00AM EDT</div> </td> <td> <a>New England Surf Metro Boston U10 Boys Sky</a> </td> <td> - </td> <td> <a>Other Club U10</a> </td> <td> <ul><li>Field</li></ul> </td> <td> <a>Flight 3 Lancaster</a> </td> </tr>
</table>`;

const ECNL = `<table><tr><th>GM#</th></tr>
<tr style="background-color: #ffffff"> <td>1120354</td> <td> <div style="font-weight: 600;">Sep 13, 2026</div> <div>12:00 PM</div> <div>GU13 - Teal</div> </td> <td> <div> <img> <span class="individual-team-item">New England Surf ECNL RL G2013/14</span> </div> <div> <img> <span class="individual-team-item">Albany Alleycats ECNL RL G2013/14</span> </div> <div> <span class="game-complex-item">The Fessenden School - Lower Field</span> </div> </td> <td><div>1</div> <div>5</div><div class="box-score-item">Box Score</div></td></tr>
<tr> <td>1120399</td> <td> <div>Nov 15, 2026</div> <div>10:00 AM</div> <div>GU16 - Teal</div> </td> <td> <div><span class="individual-team-item">PDA South ECNL RL G2010</span></div> <div><span class="individual-team-item">New England Surf ECNL RL G2010</span></div> <div><span class="game-complex-item">PDA Complex - 3</span></div> </td> <td><div class="box-score-item">Preview</div></td></tr>
</table>`;

const MLS = JSON.stringify({ team: { ageGroup: "U13", conference: "New England" }, schedule: [
  { id: 5875509, startTime: "2026-09-12T16:00:00Z", completed: true, home: "New York Rush", away: "New England Surf SC", homeScore: 1, awayScore: 3, location: "Rush Park" },
  { id: 5875600, startTime: "2026-10-25T13:00:00Z", completed: false, home: "New England Surf SC", away: "Bayside FC", homeScore: null, awayScore: null, location: "Fessenden School Upper Field" },
  { id: 5875601, startTime: "2026-10-25T13:00:00Z", completed: false, home: "NEFC", away: "Bayside FC", homeScore: null, awayScore: null, location: "x" },
]});

const origFetch = globalThis.fetch;
globalThis.fetch = (async (url: string) => {
  const u = String(url);
  const body = u.includes("gotsport") ? (u.includes("55967") || u.includes("54245") || u.includes("55964") ? GS : "<table></table>") : u.includes("athleteone") ? (u.endsWith("/41761/0") ? ECNL : "<table><tr><td>No Records Found</td></tr></table>") : u.includes("mlsnexttracker") ? (u.includes("u13") ? MLS : JSON.stringify({ schedule: [] })) : "";
  return new Response(body, { status: 200 });
}) as any;

const { buildSnapshot } = await import("../src/scrape.ts");
const snap = await buildSnapshot();
console.log("sources:", snap.sources.map(s => `${s.name}:${s.ok ? s.count : "FAIL " + s.error}`).join(" | "));
for (const f of snap.fixtures) console.log(f.date, f.time.padEnd(8), f.league.padEnd(5), f.status.padEnd(9), `${f.surfTeam} [${f.gender} U${f.age} ${f.tier} ${f.region}]`, f.isHome ? "vs" : "@", f.opponent, f.homeScore ?? "-", f.awayScore ?? "-", f.result, "| coach:", f.coach || "(none)");
globalThis.fetch = origFetch;
