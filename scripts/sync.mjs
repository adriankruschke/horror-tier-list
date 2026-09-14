// Pulls every year tab from the Google Sheet, normalises ratings into tiers,
// resolves IMDb ids and caches IMDb details into src/data/*.json.
//
//   node scripts/sync.mjs            -> sync sheet + fetch missing/stale IMDb data
//   node scripts/sync.mjs --refresh  -> re-fetch IMDb details for every title

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SHEET_ID = '1i1tKUeFFXd4-1COF4mwMrbRCsRxv9xRdg2yrz6TKXR0';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'src', 'data');
const FILES = {
  years: path.join(DATA, 'years.json'),
  imdb: path.join(DATA, 'imdb.json'),
  lookups: path.join(DATA, 'lookups.json'),
  overrides: path.join(DATA, 'overrides.json'),
};
const STALE_MS = 14 * 24 * 60 * 60 * 1000;
const REFRESH = process.argv.includes('--refresh');
const UA = 'Mozilla/5.0 (compatible; horror-tier-list-sync/1.0)';

const TIERS = {
  excellent: 'S', s: 'S',
  great: 'A', a: 'A',
  good: 'B', b: 'B',
  meh: 'C', c: 'C',
  bad: 'D', d: 'D',
  unfinishable: 'F', 'not worth finishing': 'F', unfinished: 'F', f: 'F',
  unclassifiable: 'U', u: 'U',
};
const tierOf = (v) => TIERS[String(v ?? '').trim().toLowerCase()] ?? null;

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
}
const writeJson = (file, data) => writeFile(file, JSON.stringify(data, null, 2) + '\n');

async function get(url, init = {}) {
  const res = await fetch(url, { ...init, headers: { 'User-Agent': UA, ...(init.headers || {}) } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res;
}

// ---------- CSV ----------
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((c) => c.trim()));
}

// ---------- Sheet ----------
async function discoverTabs() {
  const html = await (await get(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/htmlview`)).text();
  const tabs = [];
  for (const m of html.matchAll(/items\.push\(\{name: "([^"]*)", pageUrl: "[^"]*", gid: "(\d+)"/g)) {
    const year = m[1].match(/\b(19|20)\d{2}\b/);
    if (year) tabs.push({ name: m[1], gid: m[2], year: Number(year[0]) });
  }
  return tabs;
}

const imdbIdFrom = (s) => (String(s).match(/tt\d{6,}/) || [])[0] || null;
const minutes = (s) => (/^\d{1,3}$/.test(s) ? Number(s) : null);
const isDate = (s) => /^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/.test(s);
const PRIVATE = [/\bwife\b/i];
const isPrivate = (s) => PRIVATE.some((re) => re.test(s ?? ''));

function parseTab(rows) {
  const entries = [];
  const awards = [];
  let awardsCol = -1;

  // Header layout (2025+): "Watched?, Name, Link, Streaming Service, Runtime, Notes"
  const header = rows[0]?.map((c) => c.toLowerCase()) ?? [];
  const hasHeader = header.includes('name');
  const col = (re, fallback) => {
    const i = header.findIndex((h) => re.test(h));
    return i === -1 ? fallback : i;
  };
  const C = hasHeader
    ? {
        tier: col(/watch|rating|tier|verdict/, 0),
        name: col(/^name|title/, 1),
        link: col(/link|imdb/, 2),
        streaming: col(/stream|service|where/, 3),
        runtime: col(/runtime|length/, 4),
        notes: col(/note/, 5),
      }
    : { tier: 0, name: 1, link: 2, streaming: 3, runtime: 4, notes: 5 };

  let section = null; // for the 2023 "tier heading, then rows" layout
  rows.slice(hasHeader ? 1 : 0).forEach((r) => {
    const cell = (i) => (i >= 0 ? r[i] ?? '' : '');

    // Awards column (2024): a lone "AWARDS" cell, then "Label: value" cells beneath.
    const awardsAt = r.findIndex((c) => c.toUpperCase() === 'AWARDS');
    if (awardsAt !== -1) awardsCol = awardsAt;
    else if (awardsCol !== -1 && cell(awardsCol).includes(':')) {
      const [label, ...rest] = cell(awardsCol).split(':');
      awards.push({ label: label.trim(), value: rest.join(':').trim() });
    }

    const first = cell(0);
    const t = tierOf(first);
    const restEmpty = [1, 2, 3].every((i) => !cell(i));

    if (!hasHeader && t && restEmpty) { section = t; return; }

    if (!hasHeader && !t && section && first) {
      // Section layout: Name, Streaming, Date watched, watched flag
      entries.push({
        name: first,
        imdbId: r.map(imdbIdFrom).find(Boolean) || null,
        tier: section,
        streaming: cell(1) || null,
        runtime: null,
        watchedOn: r.find(isDate) || null,
        notes: null,
      });
      return;
    }

    const name = cell(C.name);
    if (!name) return;
    const notes = cell(C.notes);
    entries.push({
      name,
      imdbId: imdbIdFrom(cell(C.link)),
      tier: tierOf(cell(C.tier)),
      streaming: cell(C.streaming) || null,
      runtime: minutes(cell(C.runtime)),
      watchedOn: null,
      notes: notes && !/^\d+$/.test(notes) ? notes : null,
    });
  });
  // Personal lines stay in the sheet but never reach the site.
  for (const e of entries) if (isPrivate(e.notes)) e.notes = null;
  return { entries, awards: awards.filter((a) => !isPrivate(a.label) && !isPrivate(a.value)) };
}

// ---------- IMDb ----------
function searchTerms(name) {
  const year = (name.match(/\((\d{4})\)/) || [])[1];
  const clean = name.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  return { clean, year: year ? Number(year) : null };
}

async function searchImdb(name) {
  const { clean, year } = searchTerms(name);
  const q = clean.toLowerCase();
  const url = `https://v2.sg.media-imdb.com/suggestion/${encodeURIComponent(q[0])}/${encodeURIComponent(q)}.json`;
  const json = await (await get(url)).json();
  const hits = (json.d || []).filter((d) => d.id?.startsWith('tt') && ['movie', 'tvMovie', 'video'].includes(d.qid));
  const pick = (year && hits.find((h) => h.y === year)) || hits[0];
  return pick ? { id: pick.id, title: pick.l, year: pick.y ?? null } : null;
}

const DETAILS_QUERY = `query ($ids: [ID!]!) {
  titles(ids: $ids) {
    id
    titleText { text }
    releaseYear { year }
    runtime { seconds }
    ratingsSummary { aggregateRating voteCount }
    plot { plotText { plainText } }
    genres { genres { text } }
    certificate { rating }
    primaryImage { url width height }
    principalCredits { category { id text } credits(limit: 4) { name { nameText { text } } } }
    primaryVideos(first: 10) { edges { node { id name { value } contentType { id } } } }
  }
}`;

async function fetchDetails(ids) {
  const res = await get('https://caching.graphql.imdb.com/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-imdb-client-name': 'imdb-web-next' },
    body: JSON.stringify({ query: DETAILS_QUERY, variables: { ids } }),
  });
  const json = await res.json();
  if (!json.data) throw new Error(JSON.stringify(json.errors || json).slice(0, 300));
  return json.data.titles.filter(Boolean).map((t) => {
    const credits = (cat) =>
      (t.principalCredits || [])
        .find((c) => c.category?.id === cat)
        ?.credits.map((c) => c.name.nameText.text) ?? [];
    const videos = (t.primaryVideos?.edges || []).map((e) => e.node);
    const trailer = videos.find((v) => v.contentType?.id === 'amzn1.imdb.video.contenttype.trailer') || videos[0];
    return {
      id: t.id,
      title: t.titleText?.text ?? null,
      year: t.releaseYear?.year ?? null,
      runtime: t.runtime ? Math.round(t.runtime.seconds / 60) : null,
      rating: t.ratingsSummary?.aggregateRating ?? null,
      votes: t.ratingsSummary?.voteCount ?? null,
      certificate: t.certificate?.rating ?? null,
      plot: t.plot?.plotText?.plainText ?? null,
      genres: (t.genres?.genres || []).map((g) => g.text),
      directors: credits('director'),
      stars: credits('cast'),
      image: t.primaryImage ? { url: t.primaryImage.url, width: t.primaryImage.width, height: t.primaryImage.height } : null,
      trailer: trailer ? { id: trailer.id, name: trailer.name?.value ?? 'Trailer' } : null,
      fetchedAt: new Date().toISOString(),
    };
  });
}

// ---------- main ----------
async function main() {
  const prevYears = await readJson(FILES.years, []);
  const imdb = await readJson(FILES.imdb, {});
  const lookups = await readJson(FILES.lookups, {});
  const overrides = await readJson(FILES.overrides, {});

  const tabs = await discoverTabs();
  if (!tabs.length) throw new Error('No year tabs found in the sheet');

  const years = [];
  for (const tab of tabs) {
    try {
      const csv = await (await get(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${tab.gid}`)).text();
      const { entries, awards } = parseTab(parseCsv(csv));
      years.push({ year: tab.year, tab: tab.name, gid: tab.gid, entries, awards });
      console.log(`sheet  ${tab.name}: ${entries.length} titles (${entries.filter((e) => e.tier).length} rated)`);
    } catch (err) {
      const prev = prevYears.find((y) => y.year === tab.year);
      console.warn(`sheet  ${tab.name}: FAILED (${err.message})${prev ? ' - keeping previous data' : ''}`);
      if (prev) years.push(prev);
    }
  }
  years.sort((a, b) => b.year - a.year);

  // Resolve ids: manual override > link in sheet > cached search > live search
  for (const y of years) {
    for (const e of y.entries) {
      const key = e.name.toLowerCase();
      if (overrides[key]) { e.imdbId = overrides[key]; continue; }
      if (e.imdbId) continue;
      if (lookups[key] === undefined) {
        try {
          const hit = await searchImdb(e.name);
          lookups[key] = hit ? hit.id : null;
          console.log(`search "${e.name}" -> ${hit ? `${hit.title} (${hit.year}) ${hit.id}` : 'no match'}`);
        } catch (err) {
          console.warn(`search "${e.name}" failed: ${err.message}`);
          continue;
        }
      }
      e.imdbId = lookups[key];
    }
  }

  const ids = [...new Set(years.flatMap((y) => y.entries.map((e) => e.imdbId)).filter(Boolean))];
  const todo = ids.filter((id) => REFRESH || !imdb[id] || Date.now() - Date.parse(imdb[id].fetchedAt) > STALE_MS);
  for (let i = 0; i < todo.length; i += 20) {
    const batch = todo.slice(i, i + 20);
    try {
      for (const d of await fetchDetails(batch)) imdb[d.id] = d;
      console.log(`imdb   fetched ${Math.min(i + 20, todo.length)}/${todo.length}`);
    } catch (err) {
      console.warn(`imdb   batch failed (${err.message}) - using cached data`);
    }
  }

  // Drop cache entries no longer referenced
  for (const id of Object.keys(imdb)) if (!ids.includes(id)) delete imdb[id];

  await writeJson(FILES.years, years);
  await writeJson(FILES.imdb, Object.fromEntries(Object.entries(imdb).sort()));
  await writeJson(FILES.lookups, Object.fromEntries(Object.entries(lookups).sort()));
  if (!Object.keys(overrides).length) await writeJson(FILES.overrides, {});
  console.log(`done   ${years.length} years, ${ids.length} unique titles`);
}

main().catch((err) => { console.error(err); process.exit(1); });
