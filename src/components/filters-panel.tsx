"use client";

import type { PlaylistFacet } from "@/lib/library/facets";
import type { FilterDraft } from "@/lib/library/filters";

const field = "w-full min-w-0 rounded-md border border-line bg-ink px-2.5 py-1.5 text-sm outline-none focus:border-accent";

export function FiltersPanel({
  draft,
  playlists,
  onChange,
  onReset,
}: {
  draft: FilterDraft;
  playlists: PlaylistFacet[];
  onChange: (next: FilterDraft) => void;
  onReset: () => void;
}) {
  const set = (patch: Partial<FilterDraft>) => onChange({ ...draft, ...patch });
  const decades = [1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020];
  return (
    <form className="flex flex-col gap-4 p-4" onSubmit={(event) => event.preventDefault()}>
      <div className="grid grid-cols-2 gap-1 rounded-full bg-ink p-1">
        <button
          type="button"
          className={`rounded-full px-2 py-1.5 text-xs ${draft.view === "added" ? "bg-accent text-accent-ink" : "text-muted"}`}
          onClick={() => set({ view: "added" })}
        >
          Songs I added
        </button>
        <button
          type="button"
          className={`rounded-full px-2 py-1.5 text-xs ${draft.view === "album" ? "bg-accent text-accent-ink" : "text-muted"}`}
          onClick={() => set({ view: "album" })}
        >
          Album-only
        </button>
      </div>
      <p className="text-xs leading-relaxed text-muted">
        Songs you added are liked tracks and anything on your playlists. Album-only songs showed up because you saved the album.
      </p>
      <label className="block text-xs text-muted">
        Search
        <input className={`${field} mt-1`} value={draft.q} placeholder="Song, artist, album" onChange={(event) => set({ q: event.target.value })} />
      </label>
      <label className="block text-xs text-muted">
        Artist
        <input className={`${field} mt-1`} value={draft.artist} placeholder="Primary or featured" onChange={(event) => set({ artist: event.target.value })} />
      </label>
      <label className="block text-xs text-muted">
        Decade
        <select className={`${field} mt-1`} value={draft.decade} onChange={(event) => set({ decade: event.target.value })}>
          <option value="">Any decade</option>
          {decades.map((decade) => (
            <option key={decade} value={decade}>
              {decade}s
            </option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-muted">
          Year from
          <input className={`${field} mt-1`} inputMode="numeric" value={draft.yearFrom} onChange={(event) => set({ yearFrom: event.target.value })} />
        </label>
        <label className="text-xs text-muted">
          Year to
          <input className={`${field} mt-1`} inputMode="numeric" value={draft.yearTo} onChange={(event) => set({ yearTo: event.target.value })} />
        </label>
      </div>
      <label className="block text-xs text-muted">
        Source
        <select className={`${field} mt-1`} value={draft.source} onChange={(event) => set({ source: event.target.value as FilterDraft["source"] })}>
          <option value="">Any source</option>
          <option value="liked">Liked</option>
          <option value="playlist">A playlist</option>
          <option value="album">An album</option>
        </select>
      </label>
      <label className="block text-xs text-muted">
        Playlist
        <select className={`${field} mt-1`} value={draft.playlistId} onChange={(event) => set({ playlistId: event.target.value })}>
          <option value="">All playlists</option>
          {playlists.map((playlist) => (
            <option key={playlist.id} value={playlist.id}>
              {playlist.name}
              {playlist.tracksUnavailable ? " (tracks unavailable)" : ""}
            </option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-muted">
          Added from
          <input className={`${field} mt-1`} type="date" value={draft.addedFrom} onChange={(event) => set({ addedFrom: event.target.value })} />
        </label>
        <label className="text-xs text-muted">
          Added to
          <input className={`${field} mt-1`} type="date" value={draft.addedTo} onChange={(event) => set({ addedTo: event.target.value })} />
        </label>
      </div>
      <label className="block text-xs text-muted">
        Explicit
        <select className={`${field} mt-1`} value={draft.explicit} onChange={(event) => set({ explicit: event.target.value as FilterDraft["explicit"] })}>
          <option value="">Any</option>
          <option value="yes">Explicit</option>
          <option value="no">Clean</option>
        </select>
      </label>
      <button type="button" className="text-left text-sm text-muted underline-offset-2 hover:underline" onClick={onReset}>
        Reset filters
      </button>
    </form>
  );
}
