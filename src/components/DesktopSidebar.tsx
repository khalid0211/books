"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = { href: string; label: string; roles?: string[] };

const library: Item[] = [
  { href: "/loans", label: "Borrowing & returns", roles: ["OWNER", "LIBRARIAN"] },
  { href: "/", label: "Catalog" },
  { href: "/books/new", label: "Add book", roles: ["OWNER", "LIBRARIAN"] },
  { href: "/books/move", label: "Move books", roles: ["OWNER", "LIBRARIAN"] },
  { href: "/classify", label: "Classify books", roles: ["OWNER", "LIBRARIAN"] },
  { href: "/books/labels", label: "Print labels" },
];
const organization: Item[] = [
  { href: "/owners", label: "Book owners", roles: ["OWNER", "LIBRARIAN"] },
  { href: "/locations", label: "Locations", roles: ["OWNER", "LIBRARIAN"] },
];
const administration: Item[] = [
  { href: "/database", label: "Backup & restore", roles: ["OWNER"] },
  { href: "/users", label: "Manage users", roles: ["OWNER"] },
];

export default function DesktopSidebar({ role }: { role: string }) {
  const pathname = usePathname();
  function section(title: string, items: Item[]) {
    const visible = items.filter((item) => !item.roles || item.roles.includes(role));
    if (!visible.length) return null;
    return <div className="space-y-1">
      <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[.14em] text-emerald-200/60">{title}</p>
      {visible.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={`block rounded-lg px-3 py-2.5 text-sm font-medium transition ${active ? "bg-white text-emerald-950 shadow-sm" : "text-emerald-50 hover:bg-white/10 hover:text-white"}`}>{item.label}</Link>;
      })}
    </div>;
  }
  return <aside className="desktop-sidebar hidden w-60 shrink-0 self-stretch bg-emerald-950 text-white md:block">
    <div className="sticky top-0 flex h-screen flex-col overflow-y-auto px-4 py-6">
      <Link href="/" className="mb-8 px-3">
        <span className="block text-xs font-semibold uppercase tracking-[.18em] text-emerald-300">Personal library</span>
        <span className="mt-1 block text-xl font-semibold tracking-tight">Book Catalog</span>
      </Link>
      <nav aria-label="Desktop navigation" className="space-y-7">
        {section("Library", library)}
        {section("Organization", organization)}
        {section("Administration", administration)}
      </nav>
      <p className="mt-auto px-3 pt-8 text-xs leading-relaxed text-emerald-200/60">Catalog, organize, label, and protect your collection.</p>
    </div>
  </aside>;
}
