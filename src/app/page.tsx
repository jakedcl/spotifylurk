import Link from "next/link";
import { devPreviewEnabled } from "@/lib/env";
import { getCurrentUser } from "@/lib/users";

const ERRORS: Record<string, string> = {
  config: "SPOTIFY_CLIENT_ID or SPOTIFY_REDIRECT_URI is missing.",
  state: "That login attempt expired. Try again.",
  spotify: "Spotify didn't finish signing you in. Try again.",
  denied: "Spotify access was declined.",
  seed: "The sample library isn't loaded. Run npm run db:seed, then try again.",
};

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  let signedIn = false;
  let dbError = false;
  try {
    signedIn = Boolean(await getCurrentUser());
  } catch (error) {
    console.error(error);
    dbError = true;
  }
  const error = params.error ? ERRORS[params.error] : null;
  const preview = devPreviewEnabled();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center px-6 py-16">
      <p className="flex items-center gap-2 text-sm text-muted">
        <span className="inline-block h-2.5 w-2.5 bg-accent" aria-hidden />
        Pile
      </p>
      <h1 className="mt-4 text-4xl leading-tight tracking-tight">Every song you saved, in one list.</h1>
      <p className="mt-4 text-lg leading-relaxed text-muted">
        Liked tracks, songs on your playlists, and tracks from albums you saved. Search them, keep the ones you
        added separate from album-only songs, and ask questions about the pile.
      </p>
      {dbError ? (
        <p className="mt-6 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          The database is unreachable. Check DATABASE_URL, then run npm run db:setup.
        </p>
      ) : null}
      {error ? (
        <p className="mt-6 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>
      ) : null}
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        {signedIn ? (
          <Link href="/library" className="rounded-full bg-accent px-5 py-2.5 text-center text-sm font-medium text-accent-ink">
            Back to your library
          </Link>
        ) : (
          <a href="/api/auth/login" className="rounded-full bg-accent px-5 py-2.5 text-center text-sm font-medium text-accent-ink">
            Continue with Spotify
          </a>
        )}
        {preview ? (
          <form action="/api/auth/dev" method="post">
            <button className="w-full rounded-full border border-line px-5 py-2.5 text-sm hover:bg-panel" type="submit">
              Open the sample library
            </button>
          </form>
        ) : null}
      </div>
      <p className="mt-8 text-sm leading-relaxed text-muted">
        Spotify development mode allows 5 users. Add each person under User Management in the Spotify dashboard. The
        redirect URI has to use 127.0.0.1, not localhost.
      </p>
    </main>
  );
}
