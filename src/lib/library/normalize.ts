const REMOVABLE =
  /\b(remaster(?:ed)?|mono|stereo|deluxe|bonus track|radio edit|album version|single version)\b/g;

export function normalizeText(input: string) {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/\b(feat|ft|featuring)\b\.?\s+.*/g, " ")
    .replace(REMOVABLE, " ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function nameArtistKey(name: string, primaryArtist: string) {
  return `${normalizeText(name)}|${normalizeText(primaryArtist)}`;
}

export function releaseYearFromDate(date: string | null | undefined) {
  if (!date) return null;
  const year = Number(date.slice(0, 4));
  if (!Number.isInteger(year) || year < 1800 || year > 3000) return null;
  return year;
}

export function searchText(name: string, artists: string[], album: string | null) {
  return [name, ...artists, album ?? ""].join(" ").toLowerCase().replace(/\s+/g, " ").trim();
}
