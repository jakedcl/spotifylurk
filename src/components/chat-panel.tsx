"use client";

import { useEffect, useRef, useState } from "react";
import { formatCost, formatDuration } from "@/lib/format";
import type { ProposalCard } from "@/lib/ai/tools";

type Usage = { promptTokens: number; completionTokens: number; estimatedCostUsd: number };

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  proposalIds: string[];
  usage: Usage | null;
};

const SUGGESTIONS = [
  "What artists did I save the most in 2021?",
  "Which of my playlists have the most 70s songs?",
  "Make a short playlist of non-explicit songs from the 90s",
];

export function ChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [proposals, setProposals] = useState<Record<string, ProposalCard>>({});
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<Record<string, { error?: string; url?: string; pending?: boolean }>>({});
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/chat", { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load the chat.");
        setMessages(data.messages);
        const map: Record<string, ProposalCard> = {};
        for (const proposal of data.proposals as ProposalCard[]) map[proposal.id] = proposal;
        setProposals(map);
        setLoading(false);
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(caught instanceof Error ? caught.message : "Could not load the chat.");
        setLoading(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages, sending]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || sending) return;
    setDraft("");
    setSending(true);
    setError(null);
    const optimistic: ChatMessage = {
      id: `local-${Date.now()}`,
      role: "user",
      content: message,
      proposalIds: [],
      usage: null,
    };
    setMessages((current) => [...current, optimistic]);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The chat request failed.");
      setMessages((current) => [...current.filter((item) => item.id !== optimistic.id), { ...optimistic, id: `${optimistic.id}-kept` }, data.message]);
      if (data.proposals?.length) {
        setProposals((current) => {
          const next = { ...current };
          for (const proposal of data.proposals as ProposalCard[]) next[proposal.id] = proposal;
          return next;
        });
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The chat request failed.");
    } finally {
      setSending(false);
    }
  }

  async function saveProposal(id: string) {
    setSaveState((current) => ({ ...current, [id]: { pending: true } }));
    try {
      const response = await fetch(`/api/proposals/${id}/save`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save the playlist.");
      setProposals((current) => ({
        ...current,
        [id]: { ...current[id], status: "saved", spotifyPlaylistId: data.spotifyPlaylistId },
      }));
      setSaveState((current) => ({ ...current, [id]: { url: data.url } }));
    } catch (caught) {
      setSaveState((current) => ({
        ...current,
        [id]: { error: caught instanceof Error ? caught.message : "Could not save the playlist." },
      }));
    }
  }

  async function clearChat() {
    await fetch("/api/chat", { method: "DELETE" });
    setMessages([]);
    setProposals({});
    setError(null);
  }

  const spent = messages.reduce((sum, message) => sum + (message.usage?.estimatedCostUsd ?? 0), 0);
  const lastUsage = [...messages].reverse().find((message) => message.usage)?.usage;

  return (
    <section className="flex h-full min-h-0 w-full min-w-0 flex-col border-line lg:border-l">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <div>
          <h2 className="text-sm">Ask the library</h2>
          <p className="text-xs text-muted">Looks songs up. Never sends the whole pile.</p>
        </div>
        <button type="button" className="text-xs text-muted hover:text-[#f3f1e8]" onClick={() => void clearChat()}>
          Clear
        </button>
      </header>
      <div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-auto px-4 py-4">
        {loading ? <p className="text-sm text-muted">Loading chat…</p> : null}
        {!loading && messages.length === 0 ? (
          <div className="space-y-3">
            <p className="text-sm leading-relaxed text-muted">
              Ask what you saved, or describe a playlist. Drafts stay here until you save them to Spotify.
            </p>
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className="block w-full rounded-md border border-line px-3 py-2 text-left text-sm hover:bg-panel-2"
                onClick={() => void send(suggestion)}
              >
                {suggestion}
              </button>
            ))}
          </div>
        ) : null}
        {messages.map((message) => (
          <div key={message.id} className={message.role === "user" ? "ml-6" : "mr-4"}>
            <p className={`rounded-lg px-3 py-2 text-sm leading-relaxed ${message.role === "user" ? "bg-panel-2" : "bg-ink"}`}>
              {message.content}
            </p>
            {message.proposalIds.map((id) => {
              const proposal = proposals[id];
              if (!proposal) return null;
              const state = saveState[id];
              return (
                <article key={id} className="mt-2 rounded-lg border border-line p-3">
                  <h3 className="text-sm">{proposal.name}</h3>
                  <p className="mt-1 text-xs text-muted">
                    {proposal.trackCount} songs · {formatDuration(proposal.durationMs)}
                  </p>
                  {proposal.description ? <p className="mt-2 text-xs text-muted">{proposal.description}</p> : null}
                  <ul className="mt-2 space-y-1 text-xs text-muted">
                    {proposal.tracks.slice(0, 8).map((track) => (
                      <li key={track.id} className="truncate">
                        {track.name}
                        {track.artists ? ` — ${track.artists}` : ""}
                      </li>
                    ))}
                  </ul>
                  {proposal.status === "saved" || state?.url ? (
                    <a
                      className="mt-3 inline-block text-sm text-accent"
                      href={state?.url || `https://open.spotify.com/playlist/${proposal.spotifyPlaylistId}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open in Spotify
                    </a>
                  ) : (
                    <button
                      type="button"
                      className="mt-3 rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink disabled:opacity-50"
                      disabled={state?.pending}
                      onClick={() => void saveProposal(id)}
                    >
                      {state?.pending ? "Saving…" : "Save to Spotify"}
                    </button>
                  )}
                  {state?.error || proposal.error ? <p className="mt-2 text-xs text-danger">{state?.error || proposal.error}</p> : null}
                </article>
              );
            })}
          </div>
        ))}
        {sending ? <p className="text-sm text-muted">Looking through your library…</p> : null}
        {error ? <p className="text-sm text-danger">{error}</p> : null}
      </div>
      <form
        className="border-t border-line p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void send(draft);
        }}
      >
        <div className="flex gap-2">
          <input
            className="min-w-0 flex-1 rounded-md border border-line bg-ink px-2.5 py-2 text-sm outline-none focus:border-accent"
            value={draft}
            placeholder="Ask about your songs"
            onChange={(event) => setDraft(event.target.value)}
            disabled={sending}
          />
          <button className="rounded-full bg-accent px-3 text-sm font-medium text-accent-ink disabled:opacity-50" type="submit" disabled={sending || !draft.trim()}>
            Send
          </button>
        </div>
        <p className="mt-2 text-[11px] text-muted">
          {lastUsage
            ? `Last reply ${lastUsage.promptTokens + lastUsage.completionTokens} tokens · about ${formatCost(lastUsage.estimatedCostUsd)}`
            : "Token cost shows up here after a reply."}
          {spent > 0 ? ` · session about ${formatCost(spent)}` : ""}
        </p>
      </form>
    </section>
  );
}
