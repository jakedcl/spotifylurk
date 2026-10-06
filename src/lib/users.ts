import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { SESSION_COOKIE, openSession } from "./session";

export type CurrentUser = {
  id: string;
  spotifyId: string;
  displayName: string;
  imageUrl: string | null;
  isDev: boolean;
  hasSpotify: boolean;
};

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const jar = await cookies();
  const session = openSession(jar.get(SESSION_COOKIE)?.value);
  if (!session) return null;
  const rows = await getDb().select().from(users).where(eq(users.id, session.uid)).limit(1);
  const user = rows[0];
  if (!user) return null;
  return {
    id: user.id,
    spotifyId: user.spotifyId,
    displayName: user.displayName,
    imageUrl: user.imageUrl,
    isDev: user.isDev,
    hasSpotify: Boolean(user.refreshTokenEnc),
  };
}
