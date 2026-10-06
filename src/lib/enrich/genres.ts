export type GenreEnrichmentStatus = {
  status: "not_enriched";
  detail: string;
};

/** Stage 2 fills artists.genres from MusicBrainz / Last.fm. Nothing is fetched here. */
export function genreEnrichmentStatus(): GenreEnrichmentStatus {
  return {
    status: "not_enriched",
    detail:
      "Artist genres live on artists.genres and stay empty until a later enrichment pass. Search and chat cannot filter by genre or mood yet.",
  };
}
