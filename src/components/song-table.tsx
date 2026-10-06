"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { formatDate } from "@/lib/format";
import type { LibraryRow, LibrarySource } from "@/lib/library/types";

const rowColumns =
  "lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1.2fr)_minmax(0,1.1fr)_52px_104px_minmax(0,1.3fr)]";

function Chip({ source }: { source: LibrarySource }) {
  const tone =
    source.type === "liked"
      ? "bg-accent text-accent-ink"
      : source.type === "album"
        ? "bg-[#2a3148] text-album"
        : "border border-line text-[#f3f1e8]";
  return (
    <span className={`inline-flex max-w-36 truncate rounded-full px-2 py-0.5 text-[11px] ${tone}`} title={source.label}>
      {source.label}
    </span>
  );
}

function Row({ row, compact }: { row: LibraryRow; compact: boolean }) {
  const letter = (row.album || row.name).slice(0, 1).toUpperCase();
  return (
    <div
      role="row"
      className={`grid min-w-0 items-center gap-x-3 border-b border-line/80 px-3 hover:bg-white/3 ${rowColumns}`}
    >
      <div role="cell" className="flex min-w-0 items-center gap-3 py-2">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded bg-panel-2 text-xs text-muted" aria-hidden>
          {letter}
        </span>
        <span className="min-w-0">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-sm">{row.name}</span>
            {row.explicit ? (
              <span className="rounded-sm border border-line px-1 text-[10px] text-muted" title="Explicit">
                E
              </span>
            ) : null}
          </span>
          {compact ? (
            <span className="mt-0.5 block truncate text-xs text-muted">
              {row.artists.map((artist) => artist.name).join(", ") || "Unknown artist"}
              {row.album ? ` · ${row.album}` : ""}
              {row.year ? ` · ${row.year}` : ""}
            </span>
          ) : null}
        </span>
      </div>
      {compact ? null : (
        <>
          <div role="cell" className="truncate text-sm text-muted">
            {row.artists.map((artist) => artist.name).join(", ") || "—"}
          </div>
          <div role="cell" className="truncate text-sm text-muted">
            {row.album || "—"}
          </div>
          <div role="cell" className="text-sm tabular-nums text-muted">
            {row.year ?? "—"}
          </div>
          <div role="cell" className="text-sm tabular-nums text-muted">
            {formatDate(row.addedAt)}
          </div>
        </>
      )}
      <div role="cell" className="flex flex-wrap gap-1 py-2 lg:py-0">
        {row.sources.map((source, index) => (
          <Chip key={`${source.type}-${source.playlistId ?? source.albumId ?? index}`} source={source} />
        ))}
      </div>
    </div>
  );
}

export function SongTable({
  rows,
  total,
  loading,
  loadingMore,
  onNearEnd,
}: {
  rows: LibraryRow[];
  total: number;
  loading: boolean;
  loadingMore: boolean;
  onNearEnd: () => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  useLayoutEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)");
    const apply = () => setCompact(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);
  // TanStack Virtual returns functions the React compiler cannot memoize.
  // eslint-disable-next-line react-hooks/incompatible-library -- required for windowed rows
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => (compact ? 92 : 56),
    overscan: 10,
  });
  // Row slots are cached from estimateSize. Crossing lg changes the real row
  // height, but the cache does not watch that function, so a resize keeps the
  // height from the first layout until we measure again.
  useLayoutEffect(() => {
    virtualizer.measure();
  }, [compact, virtualizer]);
  const virtualItems = virtualizer.getVirtualItems();
  const lastIndex = virtualItems.at(-1)?.index ?? -1;
  useEffect(() => {
    if (lastIndex >= rows.length - 8 && rows.length < total) onNearEnd();
  }, [lastIndex, rows.length, total, onNearEnd]);

  if (loading) {
    return (
      <div className="space-y-2 p-3" aria-busy="true" aria-live="polite">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="h-12 animate-pulse rounded bg-panel-2" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        role="row"
        className={`hidden min-w-0 ${rowColumns} gap-x-3 border-b border-line px-3 py-2 text-[11px] uppercase tracking-wide text-muted lg:grid`}
      >
        <span>Song</span>
        <span>Artists</span>
        <span>Album</span>
        <span>Year</span>
        <span>First added</span>
        <span>Where it lives</span>
      </div>
      <div ref={parentRef} className="min-h-0 flex-1 overflow-auto" role="table" aria-rowcount={total}>
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualItems.map((item) => (
            <div
              key={rows[item.index].id}
              data-index={item.index}
              ref={virtualizer.measureElement}
              style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${item.start}px)` }}
            >
              <Row row={rows[item.index]} compact={compact} />
            </div>
          ))}
        </div>
        {loadingMore ? <p className="px-3 py-3 text-sm text-muted">Loading more songs…</p> : null}
      </div>
    </div>
  );
}
