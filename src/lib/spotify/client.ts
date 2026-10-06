export class SpotifyApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export class SpotifyRateLimit extends Error {
  constructor(public retryAfterSeconds: number) {
    super(`Spotify rate limit. Retry after ${retryAfterSeconds}s.`);
  }
}

type Query = Record<string, string | number | undefined>;

export type SpotifyClientOptions = {
  fetch?: typeof fetch;
  getAccessToken: () => Promise<string>;
  refreshAccessToken: () => Promise<string>;
  sleep?: (ms: number) => Promise<void>;
};

function retryAfterSeconds(header: string | null) {
  if (!header) return 1;
  const asNumber = Number(header);
  if (Number.isFinite(asNumber)) return Math.max(0, asNumber);
  const asDate = Date.parse(header);
  if (Number.isFinite(asDate)) return Math.max(0, Math.ceil((asDate - Date.now()) / 1000));
  return 2;
}

export class SpotifyClient {
  private fetchImpl: typeof fetch;
  private sleep: (ms: number) => Promise<void>;

  constructor(private options: SpotifyClientOptions) {
    this.fetchImpl = options.fetch ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  get<T>(path: string, query?: Query) {
    return this.request<T>(path, { method: "GET", query });
  }

  post<T>(path: string, body: unknown) {
    return this.request<T>(path, { method: "POST", body });
  }

  private async request<T>(
    path: string,
    init: { method: string; query?: Query; body?: unknown; allowRefresh?: boolean; attempt?: number },
  ): Promise<T> {
    const allowRefresh = init.allowRefresh !== false;
    const attempt = init.attempt ?? 0;
    const url = new URL(path.startsWith("http") ? path : `https://api.spotify.com${path}`);
    for (const [key, value] of Object.entries(init.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const token = await this.options.getAccessToken();
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    let body: string | undefined;
    if (init.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(init.body);
    }
    const response = await this.fetchImpl(url, { method: init.method, headers, body });
    if (response.status === 401 && allowRefresh) {
      await this.options.refreshAccessToken();
      return this.request(path, { ...init, allowRefresh: false, attempt });
    }
    if (response.status === 429) {
      const seconds = retryAfterSeconds(response.headers.get("retry-after"));
      if (seconds >= 2 || attempt >= 2) throw new SpotifyRateLimit(Math.max(1, Math.ceil(seconds)));
      await this.sleep(seconds * 1000);
      return this.request(path, { ...init, allowRefresh, attempt: attempt + 1 });
    }
    const text = await response.text();
    if (!response.ok) {
      throw new SpotifyApiError(response.status, `Spotify ${response.status} ${url.pathname}: ${text.slice(0, 280)}`);
    }
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }
}
