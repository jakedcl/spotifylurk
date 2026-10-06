"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChatPanel } from "@/components/chat-panel";
import { FiltersPanel } from "@/components/filters-panel";
import { SongTable } from "@/components/song-table";
import { formatNumber } from "@/lib/format";
import type { PlaylistFacet } from "@/lib/library/facets";
import { draftToSearchParams, emptyDraft, isDefaultDraft, type FilterDraft } from "@/lib/library/filters";
import type { LibraryRow, LibrarySort } from "@/lib/library/types";

type Viewer = { displayName: string; imageUrl: string | null; isDev: boolean; hasSpotify: boolean };
type Progress = { phase: string; label: string; done: number; total: number | null };
type Pane = "songs" | "filters" | "chat";

function suggestedName(draft: FilterDraft, playlists: PlaylistFacet[]) {
  if (draft.artist.trim()) return draft.artist.trim();
  const playlist = playlists.find((item) => item.id === draft.playlistId);
  if (playlist) return playlist.name;
  if (draft.decade) return `${draft.decade}s`;
  if (draft.q.trim()) return draft.q.trim();
  return draft.view === "album" ? "Album-only songs" : "Songs I added";
}

export function LibraryApp({ user }: { user: Viewer }) {
  const [draft, setDraft] = useState<FilterDraft>(emptyDraft);
  const [debounced, setDebounced] = useState<FilterDraft>(draft);
  const [rows, setRows] = useState<LibraryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playlists, setPlaylists] = useState<PlaylistFacet[]>([]);
  const [unavailable, setUnavailable] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [pane, setPane] = useState<Pane>("songs");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveResult, setSaveResult] = useState<{ url: string; trackCount: number; truncated?: boolean } | null>(null);
  const [playlistName, setPlaylistName] = useState("");
  const requestId = useRef(0);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (draft === debounced) return;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      setDebounced(draft);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [draft, debounced]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/library/facets", { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!data) return;
        setPlaylists(data.playlists ?? []);
        setUnavailable(data.unavailablePlaylists ?? 0);
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const id = ++requestId.current;
    const controller = new AbortController();
    const params = draftToSearchParams(debounced, { offset: "0", limit: "200" });
    fetch(`/api/library?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (id !== requestId.current) return;
        if (!response.ok) throw new Error(data.error || "Could not load your library.");
        setTotal(data.total);
        setRows(data.rows);
        setLoading(false);
        setLoadingMore(false);
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted || id !== requestId.current) return;
        setError(caught instanceof Error ? caught.message : "Could not load your library.");
        setRows([]);
        setLoading(false);
        setLoadingMore(false);
      });
    return () => controller.abort();
  }, [debounced]);

  const loadFacets = useCallback(async () => {
    const response = await fetch("/api/library/facets");
    if (!response.ok) return;
    const data = await response.json();
    setPlaylists(data.playlists);
    setUnavailable(data.unavailablePlaylists ?? 0);
  }, []);

  const load = useCallback(async (next: FilterDraft, offset: number, replace: boolean) => {
    const id = replace ? ++requestId.current : requestId.current;
    if (replace) setLoading(true);
    else setLoadingMore(true);
    setError(null);
    try {
      const params = draftToSearchParams(next, { offset: String(offset), limit: "200" });
      const response = await fetch(`/api/library?${params}`);
      const data = await response.json();
      if (id !== requestId.current) return;
      if (!response.ok) throw new Error(data.error || "Could not load your library.");
      setTotal(data.total);
      setRows((current) => (replace ? data.rows : [...current, ...data.rows]));
    } catch (caught) {
      if (id !== requestId.current) return;
      setError(caught instanceof Error ? caught.message : "Could not load your library.");
      if (replace) setRows([]);
    } finally {
      if (id === requestId.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, []);

  const loadMore = useCallback(() => {
    if (loading || loadingMore || rows.length >= total) return;
    void load(debounced, rows.length, false);
  }, [debounced, load, loading, loadingMore, rows.length, total]);

  async function refresh() {
    if (!user.hasSpotify || syncing) return;
    setSyncing(true);
    setSyncError(null);
    setProgress({ phase: "liked", label: "Starting", done: 0, total: null });
    try {
      const started = await fetch("/api/sync/start", { method: "POST" });
      const startBody = await started.json();
      if (!started.ok) throw new Error(startBody.error || "Could not start the sync.");
      for (let step = 0; step < 4000; step += 1) {
        const response = await fetch("/api/sync/step", { method: "POST" });
        const data = await response.json();
        if (data.progress) setProgress(data.progress);
        if (!response.ok || data.status === "error") throw new Error(data.error || "Sync failed.");
        if (data.status === "done") break;
        if (data.retryAfter) await new Promise((resolve) => setTimeout(resolve, Math.min(data.retryAfter, 30) * 1000));
      }
      await loadFacets();
      await load(debounced, 0, true);
    } catch (caught) {
      setSyncError(caught instanceof Error ? caught.message : "Sync failed.");
    } finally {
      setSyncing(false);
    }
  }

  async function exportCsv() {
    const response = await fetch(`/api/library/export?${draftToSearchParams(draft)}`);
    if (!response.ok) {
      setError("Could not export this view.");
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "spotify-lurk.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  function openSave() {
    setPlaylistName(suggestedName(draft, playlists));
    setSaveError(null);
    setSaveResult(null);
    dialogRef.current?.showModal();
  }

  async function saveView() {
    setSaving(true);
    setSaveError(null);
    try {
      const response = await fetch("/api/playlists/from-filter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: playlistName, query: draftToSearchParams(draft).toString() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save the playlist.");
      setSaveResult(data);
      await loadFacets();
      await load(debounced, 0, true);
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : "Could not save the playlist.");
    } finally {
      setSaving(false);
    }
  }

  const countLabel = draft.view === "album" ? "album-only songs" : "songs you added";
  const emptyLibrary = !loading && total === 0 && isDefaultDraft(draft) && !error;

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="border-b border-line">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <Link href="/" className="flex items-center gap-2 text-sm">
            <span className="inline-block h-2.5 w-2.5 bg-accent" aria-hidden />
            SPOTIFY LURK
          </Link>
          <p className="min-w-0 flex-1 truncate text-sm text-muted">
            {user.displayName}
            {user.isDev ? " · sample library" : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            {user.hasSpotify ? (
              <button type="button" className="rounded-full bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink disabled:opacity-50" onClick={() => void refresh()} disabled={syncing}>
                {syncing ? "Refreshing…" : "Refresh"}
              </button>
            ) : null}
            <button type="button" className="rounded-full border border-line px-3 py-1.5 text-sm disabled:opacity-40" onClick={() => void exportCsv()} disabled={total === 0}>
              Export CSV
            </button>
            <button type="button" className="rounded-full border border-line px-3 py-1.5 text-sm disabled:opacity-40" onClick={openSave} disabled={total === 0}>
              Save as playlist
            </button>
            <form action="/api/auth/logout" method="post">
              <button type="submit" className="rounded-full px-3 py-1.5 text-sm text-muted hover:text-[#f3f1e8]">
                Log out
              </button>
            </form>
          </div>
        </div>
        {syncing || syncError ? (
          <div className="px-4 pb-3">
            <div className="h-1 overflow-hidden rounded-full bg-panel-2">
              <div
                className="h-full bg-accent transition-all"
                style={{
                  width: progress?.total ? `${Math.min(100, Math.round((progress.done / progress.total) * 100))}%` : syncing ? "35%" : "100%",
                }}
              />
            </div>
            <p className={`mt-1 text-xs ${syncError ? "text-danger" : "text-muted"}`}>
              {syncError || (progress ? `${progress.label}${progress.total ? ` · ${formatNumber(progress.done)} / ${formatNumber(progress.total)}` : ""}` : "Syncing")}
            </p>
          </div>
        ) : null}
      </header>
      <div className="flex border-b border-line lg:hidden">
        {(["songs", "filters", "chat"] as Pane[]).map((item) => (
          <button
            key={item}
            type="button"
            className={`flex-1 py-2 text-sm capitalize ${pane === item ? "text-accent" : "text-muted"}`}
            onClick={() => setPane(item)}
          >
            {item === "chat" ? "Ask" : item}
          </button>
        ))}
      </div>
      <div className="grid min-h-0 min-w-0 flex-1 lg:grid-cols-[270px_minmax(0,1fr)_360px]">
        <aside className={`${pane === "filters" ? "block" : "hidden"} min-h-0 min-w-0 overflow-auto border-line lg:block lg:border-r`}>
          <FiltersPanel draft={draft} playlists={playlists} onChange={setDraft} onReset={() => setDraft(emptyDraft())} />
        </aside>
        <main className={`${pane === "songs" ? "flex" : "hidden"} min-h-0 min-w-0 flex-col lg:flex`}>
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line px-4 py-3">
            <div>
              <p className="text-sm">
                {loading ? "Counting songs…" : `${formatNumber(total)} ${countLabel}`}
              </p>
              {unavailable > 0 ? (
                <p className="mt-1 max-w-xl text-xs text-muted">
                  {unavailable} followed {unavailable === 1 ? "playlist doesn't" : "playlists don't"} share tracks in Spotify development mode.
                </p>
              ) : null}
            </div>
            <label className="flex items-center gap-2 text-xs text-muted">
              Sort
              <select
                className="rounded-md border border-line bg-ink px-2 py-1 text-sm text-[#f3f1e8]"
                value={`${draft.sort}:${draft.dir}`}
                onChange={(event) => {
                  const [sort, dir] = event.target.value.split(":") as [LibrarySort, "asc" | "desc"];
                  setDraft((current) => ({ ...current, sort, dir }));
                }}
              >
                <option value="added:desc">Recently added</option>
                <option value="added:asc">First added</option>
                <option value="name:asc">Title</option>
                <option value="artist:asc">Artist</option>
                <option value="album:asc">Album</option>
                <option value="year:desc">Year, newest</option>
                <option value="year:asc">Year, oldest</option>
              </select>
            </label>
          </div>
          {error ? (
            <div className="m-4 rounded-md border border-danger/40 px-3 py-2 text-sm text-danger">
              {error}
              <button type="button" className="ml-3 underline" onClick={() => void load(debounced, 0, true)}>
                Retry
              </button>
            </div>
          ) : null}
          {emptyLibrary ? (
            <div className="m-4 rounded-md border border-line p-6">
              <h2 className="text-lg">No songs yet.</h2>
              <p className="mt-2 max-w-md text-sm text-muted">
                {user.hasSpotify
                  ? "Pull liked songs, your playlists, and saved albums from Spotify."
                  : "This sample library is empty. Run npm run db:seed, then open it again."}
              </p>
              {user.hasSpotify ? (
                <button type="button" className="mt-4 rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-ink" onClick={() => void refresh()}>
                  Pull from Spotify
                </button>
              ) : null}
            </div>
          ) : null}
          {!loading && total === 0 && !isDefaultDraft(draft) && !error ? (
            <div className="m-4 rounded-md border border-line p-6">
              <h2 className="text-lg">No songs match.</h2>
              <p className="mt-2 text-sm text-muted">Try a wider year range, or reset the filters.</p>
              <button type="button" className="mt-4 text-sm underline" onClick={() => setDraft(emptyDraft())}>
                Reset filters
              </button>
            </div>
          ) : null}
          {!(emptyLibrary || (!loading && total === 0 && !error)) ? (
            <SongTable rows={rows} total={total} loading={loading} loadingMore={loadingMore} onNearEnd={loadMore} />
          ) : null}
        </main>
        <div className={`${pane === "chat" ? "flex" : "hidden"} min-h-0 min-w-0 lg:flex`}>
          <ChatPanel />
        </div>
      </div>
      <dialog ref={dialogRef} className="p-5">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void saveView();
          }}
        >
          <h2 className="text-lg">Save this view as a playlist</h2>
          <p className="mt-2 text-sm text-muted">
            {formatNumber(total)} songs in the current filter, in the current sort. This creates a private playlist on Spotify.
          </p>
          <label className="mt-4 block text-xs text-muted">
            Name
            <input
              className="mt-1 w-full rounded-md border border-line bg-ink px-2.5 py-2 text-sm outline-none focus:border-accent"
              value={playlistName}
              onChange={(event) => setPlaylistName(event.target.value)}
              required
            />
          </label>
          {saveError ? <p className="mt-3 text-sm text-danger">{saveError}</p> : null}
          {saveResult ? (
            <p className="mt-3 text-sm">
              Saved {formatNumber(saveResult.trackCount)} songs.{" "}
              <a className="text-accent" href={saveResult.url} target="_blank" rel="noreferrer">
                Open in Spotify
              </a>
              {saveResult.truncated ? " The first 10,000 songs were saved." : ""}
            </p>
          ) : null}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="rounded-full px-3 py-1.5 text-sm text-muted" onClick={() => dialogRef.current?.close()}>
              Close
            </button>
            <button type="submit" className="rounded-full bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink disabled:opacity-50" disabled={saving || !playlistName.trim()}>
              {saving ? "Saving…" : "Create on Spotify"}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
