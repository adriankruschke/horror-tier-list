# Fright Ledger

A yearly horror movie marathon, ranked. Live at **https://adriankruschke.github.io/horror-tier-list/**

Built with [Astro](https://astro.build) as a fully static site and deployed to GitHub Pages.

## Where the data comes from

The [Google Sheet](https://docs.google.com/spreadsheets/d/1i1tKUeFFXd4-1COF4mwMrbRCsRxv9xRdg2yrz6TKXR0/edit) is the source of truth.
Every tab with a year in its name becomes a page (a new `2027` tab will show up automatically).

`npm run sync` reads each tab, converts ratings to tiers, and pulls poster / plot / cast / rating / trailer from IMDb into `src/data/`.

| Sheet value                         | Tier |
| ----------------------------------- | ---- |
| Excellent                           | S    |
| Great                               | A    |
| Good                                | B    |
| Meh                                 | C    |
| Bad                                 | D    |
| Unfinishable / Not Worth Finishing  | F    |
| Unclassifiable                      | U    |
| _(blank)_                           | unwatched — stays in the 2026 table only |

## Logging a new watch

1. Put the rating in the **Watched?** column of the `2026 Options` tab.
2. The GitHub Action runs every 2 hours, commits the new data, and redeploys.
   For an instant update: Actions → **Sync sheet & deploy** → Run workflow
   (or install `tools/instant-rebuild.gs` in the sheet to trigger it automatically).

New rows need an IMDb link in the **Link** column for a guaranteed match; without one the sync searches IMDb by name.
If a search picks the wrong film, pin it in `src/data/overrides.json`:

```json
{ "sheet name in lowercase": "tt1234567" }
```

## Local development

```bash
npm install
npm run sync   # optional: refresh data from the sheet
npm run dev
```

Film data and trailers are from IMDb, used here for a personal, non-commercial project.
