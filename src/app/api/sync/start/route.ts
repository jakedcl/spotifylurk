import { isUser, jsonError, rateLimitError, requireUser } from "@/lib/http";
import { enforceSyncStart } from "@/lib/limits";
import { startSync } from "@/lib/spotify/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const user = await requireUser();
  if (!isUser(user)) return user;
  if (!user.hasSpotify) return jsonError("Connect Spotify to pull a library. The sample library is already loaded.", 400);
  const limited = await enforceSyncStart(user.id);
  if (!limited.ok) return rateLimitError(limited.message, limited.retryAfterSeconds);
  try {
    const started = await startSync(user.id);
    return Response.json(started);
  } catch (error) {
    console.error(error);
    return jsonError("Could not start the sync.", 500);
  }
}
