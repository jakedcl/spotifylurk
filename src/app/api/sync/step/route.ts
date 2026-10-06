import { isUser, jsonError, requireUser } from "@/lib/http";
import { clientForUser } from "@/lib/spotify/account";
import { runSyncStep } from "@/lib/spotify/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const user = await requireUser();
  if (!isUser(user)) return user;
  if (!user.hasSpotify) return jsonError("Spotify is not connected for this account.", 400);
  try {
    const result = await runSyncStep({
      userId: user.id,
      spotifyUserId: user.spotifyId,
      client: clientForUser(user.id),
    });
    const status = result.status === "error" ? 500 : 200;
    return Response.json(result, { status });
  } catch (error) {
    console.error(error);
    return jsonError("Sync failed.", 500);
  }
}
