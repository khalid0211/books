import { requirePage, WRITE } from "@/lib/auth";
export default async function LocationsLayout({ children }: { children: React.ReactNode }) { await requirePage(WRITE); return children; }
