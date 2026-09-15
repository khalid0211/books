import type { Metadata, Viewport } from "next";
import "./globals.css";
import { currentUser } from "@/lib/auth";
import AccountBar from "@/components/AccountBar";

export const metadata: Metadata = {
  title: "Book Catalog",
  description: "Personal library catalog",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, title: "Books", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#1e293b",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  return (
    <html lang="en">
      <body className="min-h-screen">{user && <AccountBar email={user.email} role={user.role} />}{children}</body>
    </html>
  );
}
