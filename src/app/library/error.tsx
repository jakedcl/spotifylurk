"use client";

export default function LibraryError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-6">
      <h1 className="text-2xl tracking-tight">The library failed to load.</h1>
      <p className="mt-3 text-muted">Something went wrong reading your songs. Check the database is up, then try again.</p>
      <button className="mt-6 w-fit rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-ink" onClick={reset} type="button">
        Try again
      </button>
    </main>
  );
}
