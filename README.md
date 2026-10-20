# New England Surf – Fixtures Hub

One page with every club fixture, pulled hourly from:

| Source | What | How |
|---|---|---|
| GotSport | NAL (55967), NECSL Fall 2026 (55964), NEAL (56083), N1 (54245) | club schedule page, club 7671 |
| ECNL RL Girls Northeast 2026-27 (org 13, season 82, event 4310) | Teal division GU13–GU18/19 | TGS / AthleteOne schedule feed |
| Pre-ECNL Girls Northeast 2026-27 (org 21, season 86, event 4379) | North flight GU11–GU12 | TGS / AthleteOne schedule feed |
| MLS NEXT Academy | U13–U19 | mlsnexttracker.com team API |
| 2026-27 Staff Directory | coach per team | snapshot in `src/coaches-data.ts` (optional live CSV) |

## How it works

- `netlify/functions/scheduled-refresh.mts` runs every hour, scrapes all sources in parallel and writes `fixtures.json` to Netlify Blobs. If one source fails, the last good data for that source is kept.
- `netlify/functions/api.mts` serves `/api/fixtures` (cached JSON) and `/api/refresh` (manual refresh, rate-limited to once per 5 min; `?force=1` overrides).
- `public/index.html` is the UI (filters, by-team view, coach on every card, auto-reloads every 10 min).

## Config (Netlify environment variables, no code change needed)

| Var | Purpose | Example |
|---|---|---|
| `GOTSPORT_EVENTS` | Add GotSport events (e.g. NECSL Spring) | `57001:NECSL:NECSL Spring 2027,57010:NAL:NAL Spring` |
| `COACHES_CSV_URLS` | Comma-separated CSV export URLs of link-viewable sheets with the directory column layout | `https://docs.google.com/spreadsheets/d/<id>/gviz/tq?tqx=out:csv&sheet=State%20Boys,...` |
| `REFRESH_TOKEN` | If set, `/api/refresh` requires `?token=` | any string |

Season rollover: update `TGS_FEEDS` (ECNL RL + Pre-ECNL event/flight ids), `DEFAULT_GOTSPORT` in `src/scrape.ts` and `SEASON_START_YEAR` in `src/coaches.ts`.

## Local test

```
npm install
node --experimental-strip-types test/parse.test.mts
```
