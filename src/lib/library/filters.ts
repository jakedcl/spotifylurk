import { defaultFilters, type LibraryFilters, type LibrarySort, type LibraryView, type SourceType } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function text(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed.length ? trimmed : "";
}

function intOrNull(value: string | null | undefined) {
  if (!value || !value.trim()) return null;
  const n = Number(value);
  if (!Number.isInteger(n)) return null;
  return n;
}

function dayOrNull(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return DAY.test(trimmed) ? trimmed : null;
}

export function parseFilters(params: URLSearchParams): LibraryFilters {
  const filters = defaultFilters();
  const view = params.get("view");
  if (view === "album" || view === "all" || view === "added") filters.view = view;
  filters.q = text(params.get("q")).slice(0, 200);
  filters.artist = text(params.get("artist")).slice(0, 200);
  filters.yearFrom = intOrNull(params.get("yearFrom"));
  filters.yearTo = intOrNull(params.get("yearTo"));
  const decade = intOrNull(params.get("decade"));
  filters.decade = decade !== null && decade % 10 === 0 ? decade : null;
  const source = params.get("source");
  if (source === "liked" || source === "playlist" || source === "album") filters.source = source;
  const playlistId = params.get("playlistId");
  filters.playlistId = playlistId && UUID.test(playlistId) ? playlistId : null;
  filters.playlistName = text(params.get("playlistName")).slice(0, 200) || null;
  filters.addedFrom = dayOrNull(params.get("addedFrom"));
  filters.addedTo = dayOrNull(params.get("addedTo"));
  filters.addedYear = intOrNull(params.get("addedYear"));
  const explicit = params.get("explicit");
  if (explicit === "yes") filters.explicit = true;
  if (explicit === "no") filters.explicit = false;
  filters.genre = text(params.get("genre")).slice(0, 80) || null;
  const sort = params.get("sort");
  if (sort === "added" || sort === "name" || sort === "artist" || sort === "album" || sort === "year") {
    filters.sort = sort;
  }
  if (params.get("dir") === "asc") filters.dir = "asc";
  return filters;
}

export function parseLimit(value: string | null, fallback: number, max: number) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return fallback;
  return Math.min(n, max);
}

export function parseOffset(value: string | null) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) return 0;
  return n;
}

export type FilterDraft = {
  view: Exclude<LibraryView, "all">;
  q: string;
  artist: string;
  yearFrom: string;
  yearTo: string;
  decade: string;
  source: "" | SourceType;
  playlistId: string;
  addedFrom: string;
  addedTo: string;
  explicit: "" | "yes" | "no";
  sort: LibrarySort;
  dir: "asc" | "desc";
};

export function emptyDraft(): FilterDraft {
  return {
    view: "added",
    q: "",
    artist: "",
    yearFrom: "",
    yearTo: "",
    decade: "",
    source: "",
    playlistId: "",
    addedFrom: "",
    addedTo: "",
    explicit: "",
    sort: "added",
    dir: "desc",
  };
}

export function draftToSearchParams(draft: FilterDraft, extra?: Record<string, string>) {
  const params = new URLSearchParams();
  if (draft.view === "album") params.set("view", "album");
  if (draft.q.trim()) params.set("q", draft.q.trim());
  if (draft.artist.trim()) params.set("artist", draft.artist.trim());
  if (draft.yearFrom.trim()) params.set("yearFrom", draft.yearFrom.trim());
  if (draft.yearTo.trim()) params.set("yearTo", draft.yearTo.trim());
  if (draft.decade.trim()) params.set("decade", draft.decade.trim());
  if (draft.source) params.set("source", draft.source);
  if (draft.playlistId) params.set("playlistId", draft.playlistId);
  if (draft.addedFrom) params.set("addedFrom", draft.addedFrom);
  if (draft.addedTo) params.set("addedTo", draft.addedTo);
  if (draft.explicit) params.set("explicit", draft.explicit);
  params.set("sort", draft.sort);
  params.set("dir", draft.dir);
  if (extra) {
    for (const [key, value] of Object.entries(extra)) params.set(key, value);
  }
  return params;
}

export function isDefaultDraft(draft: FilterDraft) {
  const empty = emptyDraft();
  return (Object.keys(empty) as (keyof FilterDraft)[]).every((key) => draft[key] === empty[key]);
}
