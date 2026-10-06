export type LibraryView = "added" | "album" | "all";
export type LibrarySort = "added" | "name" | "artist" | "album" | "year";
export type SourceType = "liked" | "playlist" | "album";

export type LibraryFilters = {
  view: LibraryView;
  q: string;
  artist: string;
  yearFrom: number | null;
  yearTo: number | null;
  decade: number | null;
  source: SourceType | null;
  playlistId: string | null;
  playlistName: string | null;
  addedFrom: string | null;
  addedTo: string | null;
  addedYear: number | null;
  explicit: boolean | null;
  genre: string | null;
  sort: LibrarySort;
  dir: "asc" | "desc";
};

export type LibrarySource = {
  type: SourceType;
  label: string;
  playlistId: string | null;
  albumId: string | null;
};

export type LibraryArtist = { id: string; name: string };

export type LibraryRow = {
  id: string;
  name: string;
  artists: LibraryArtist[];
  album: string | null;
  albumImage: string | null;
  year: number | null;
  addedAt: string | null;
  explicit: boolean;
  durationMs: number;
  uri: string;
  sources: LibrarySource[];
};

export type LibraryQueryResult = {
  total: number;
  rows: LibraryRow[];
  warning?: string;
};

export function defaultFilters(): LibraryFilters {
  return {
    view: "added",
    q: "",
    artist: "",
    yearFrom: null,
    yearTo: null,
    decade: null,
    source: null,
    playlistId: null,
    playlistName: null,
    addedFrom: null,
    addedTo: null,
    addedYear: null,
    explicit: null,
    genre: null,
    sort: "added",
    dir: "desc",
  };
}
