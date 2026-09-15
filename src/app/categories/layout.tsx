import { requirePage, WRITE } from "@/lib/auth";
export default async function CategoriesLayout({ children }: { children: React.ReactNode }) { await requirePage(WRITE); return children; }
