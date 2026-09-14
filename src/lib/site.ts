import yearsJson from '../data/years.json';
import imdbJson from '../data/imdb.json';

export const SITE_NAME = 'Fright Ledger';

export type TierKey = 'S' | 'A' | 'B' | 'C' | 'D' | 'F' | 'U';

export const TIERS: { key: TierKey; word: string }[] = [
  { key: 'S', word: 'Excellent' },
  { key: 'A', word: 'Great' },
  { key: 'B', word: 'Good' },
  { key: 'C', word: 'Meh' },
  { key: 'D', word: 'Bad' },
  { key: 'F', word: 'Unfinishable' },
  { key: 'U', word: 'Unclassifiable' },
];
export const tierWord = (k: string | null) => TIERS.find((t) => t.key === k)?.word ?? null;

export interface ImdbTitle {
  id: string;
  title: string | null;
  year: number | null;
  runtime: number | null;
  rating: number | null;
  votes: number | null;
  certificate: string | null;
  plot: string | null;
  genres: string[];
  directors: string[];
  stars: string[];
  image: { url: string; width: number; height: number } | null;
  trailer: { id: string; name: string } | null;
}

interface SheetEntry {
  name: string;
  imdbId: string | null;
  tier: string | null;
  streaming: string | null;
  runtime: number | null;
  watchedOn: string | null;
  notes: string | null;
}

export interface Film {
  key: string;
  name: string;
  title: string;
  tier: TierKey | null;
  streaming: string | null;
  runtime: number | null;
  watchedOn: string | null;
  notes: string | null;
  imdb: ImdbTitle | null;
}

export interface Year {
  year: number;
  tab: string;
  films: Film[];
  awards: { label: string; value: string }[];
}

const imdb = imdbJson as Record<string, ImdbTitle>;

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Strip sheet asides like "(Seen a LONG time ago, rewatch due)" but keep "(2018)"-style years.
const cleanName = (s: string) => s.replace(/\s*\((?!\d{4}\))[^)]*\)/g, '').trim();

export const years: Year[] = (yearsJson as { year: number; tab: string; entries: SheetEntry[]; awards: Year['awards'] }[]).map((y) => {
  const seen = new Set<string>();
  return {
    year: y.year,
    tab: y.tab,
    awards: y.awards,
    films: y.entries.map((e) => {
      const data = e.imdbId ? imdb[e.imdbId] ?? null : null;
      let key = e.imdbId ?? slug(e.name);
      while (seen.has(key)) key += '-x';
      seen.add(key);
      return {
        key,
        name: e.name,
        title: data?.title ?? cleanName(e.name),
        tier: (e.tier as TierKey) ?? null,
        streaming: e.streaming,
        runtime: e.runtime ?? data?.runtime ?? null,
        watchedOn: e.watchedOn,
        notes: e.notes,
        imdb: data,
      };
    }),
  };
});

export const CURRENT_YEAR = Math.max(...years.map((y) => y.year));

/** IMDb's CDN resizes on the fly: ._V1_.jpg -> ._V1_QL80_UX{w}_.jpg */
export const poster = (url: string | undefined | null, width: number) =>
  url ? url.replace(/\._V1_[^/]*\.jpg$/, `._V1_QL80_UX${width}_.jpg`) : null;

export const href = (path = '') => `${import.meta.env.BASE_URL.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;

export const hoursMinutes = (mins: number) => `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;

export const totalRuntime = (films: Film[]) => films.reduce((sum, f) => sum + (f.runtime ?? 0), 0);

/** Compact payload the lightbox script reads. */
export const lightboxData = (films: Film[]) =>
  Object.fromEntries(
    films.map((f) => [
      f.key,
      {
        title: f.title,
        sheetName: f.name,
        tier: f.tier,
        tierWord: tierWord(f.tier),
        streaming: f.streaming,
        runtime: f.runtime,
        watchedOn: f.watchedOn,
        notes: f.notes,
        id: f.imdb?.id ?? null,
        year: f.imdb?.year ?? null,
        rating: f.imdb?.rating ?? null,
        votes: f.imdb?.votes ?? null,
        certificate: f.imdb?.certificate ?? null,
        plot: f.imdb?.plot ?? null,
        genres: f.imdb?.genres ?? [],
        directors: f.imdb?.directors ?? [],
        stars: f.imdb?.stars ?? [],
        poster: poster(f.imdb?.image?.url, 480),
        trailer: f.imdb?.trailer ?? null,
      },
    ]),
  );
