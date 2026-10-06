import { isUser, jsonError, requireUser } from "@/lib/http";
import { startSync } from "@/lib/spotify/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const user = await requireUser();
  if (!isUser(user)) return user;
  if (!user.hasSpotify) return jsonError("Connect Spotify to pull a library. The sample library is already loaded.", 400);
  try {
    const started = await startSync(user.id);
    return Response.json(started);
  } catch (error) {
    console.error(error);
    return jsonError("Could not start the sync.", 500);
  }
}
