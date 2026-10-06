import { redirect } from "next/navigation";
import { LibraryApp } from "@/components/library-app";
import { getCurrentUser } from "@/lib/users";

export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  return (
    <LibraryApp
      user={{
        displayName: user.displayName,
        imageUrl: user.imageUrl,
        isDev: user.isDev,
        hasSpotify: user.hasSpotify,
      }}
    />
  );
}
