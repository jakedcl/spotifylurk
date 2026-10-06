import { describe, expect, it } from "vitest";
import { dedupeKeyFor, emptyIndex, matchTrack, remember } from "../src/lib/library/dedupe";
import { normalizeText } from "../src/lib/library/normalize";
import { decryptSecret, encryptSecret } from "../src/lib/crypto";
import { openSession, sealSession } from "../src/lib/session";

describe("normalize", () => {
  it("strips remasters, accents, and featuring clauses", () => {
    expect(normalizeText("Café del Mar (Remastered)")).toBe("cafe del mar");
    expect(normalizeText("Silver Line - Remastered")).toBe("silver line");
    expect(normalizeText("Cold Kitchen (feat. Ada Moss)")).toBe("cold kitchen");
    expect(normalizeText("  Mina   Voss ")).toBe("mina voss");
  });
});

describe("dedupe", () => {
  it("matches uri, then isrc, then normalized name and primary artist", () => {
    const index = emptyIndex();
    remember(index, "track-1", {
      uri: "spotify:track:aaa",
      spotifyId: "aaa",
      name: "Silver Line",
      isrc: "USAAA1111111",
      primaryArtist: "Mina Voss",
    });

    expect(matchTrack(index, { uri: "spotify:track:aaa", spotifyId: "aaa", name: "Other", isrc: null, primaryArtist: "Someone" })?.via).toBe("uri");
    expect(
      matchTrack(index, {
        uri: "spotify:track:other",
        spotifyId: "other",
        name: "Totally different",
        isrc: "usaaa1111111",
        primaryArtist: "Someone else",
      })?.via,
    ).toBe("isrc");
    expect(
      matchTrack(index, {
        uri: "spotify:track:remaster",
        spotifyId: "remaster",
        name: "Silver Line (Remastered)",
        isrc: null,
        primaryArtist: "mina voss",
      })?.via,
    ).toBe("name");
    expect(
      matchTrack(index, {
        uri: "spotify:track:cover",
        spotifyId: "cover",
        name: "Silver Line",
        isrc: null,
        primaryArtist: "Another Artist",
      }),
    ).toBeNull();
  });

  it("does not collapse different songs that have no shared identity", () => {
    const first = dedupeKeyFor({ name: "Glass Door", primaryArtist: "Field Glass", isrc: null });
    const second = dedupeKeyFor({ name: "Glass Door", primaryArtist: "Patio Lights", isrc: null });
    expect(first).not.toBe(second);
    expect(dedupeKeyFor({ name: "Glass Door", primaryArtist: "Field Glass", isrc: "ABC" })).toBe("isrc:ABC");
  });
});

describe("session and token encryption", () => {
  it("round-trips a secret and rejects a tampered session", () => {
    const encrypted = encryptSecret("refresh-token");
    expect(decryptSecret(encrypted)).toBe("refresh-token");
    const session = sealSession("user-1", 60);
    expect(openSession(session.token)?.uid).toBe("user-1");
    expect(openSession(`${session.token}x`)).toBeNull();
    expect(openSession("not-a-session")).toBeNull();
  });
});
