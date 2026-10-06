import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Spotify Lurk",
  description: "Every song you saved, in one list.",
  openGraph: {
    title: "Spotify Lurk",
    description: "Every song you saved, in one list.",
    siteName: "Spotify Lurk",
    url: "https://spotifylurk.vercel.app",
    type: "website",
  },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
