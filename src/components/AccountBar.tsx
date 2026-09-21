"use client";
import Link from "next/link";
import { useState } from "react";
export default function AccountBar({ email, role }: { email: string; role: string }) {
  const [error, setError] = useState("");
  async function logout() {
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      if (!res.ok) throw new Error();
      window.location.assign("/login");
    } catch { setError("Could not sign out. Try again."); }
  }
  return <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-2 text-xs text-slate-500 md:gap-5 md:px-8 md:py-4"><span className="break-all md:mr-auto">{email} · {role === "DATA_ENTRY" || role === "LIBRARIAN" ? "Librarian" : role === "OWNER" ? "Owner" : "View"}</span>{role === "OWNER" && <Link href="/database" className="hidden underline md:inline">Backup &amp; restore</Link>}{role === "OWNER" && <Link href="/users" className="underline">Manage users</Link>}<button onClick={logout} className="underline">Sign out</button>{error && <span role="alert">{error}</span>}</div>;
}
