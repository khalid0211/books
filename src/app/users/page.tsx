import { requirePage, OWNER } from "@/lib/auth";
import UserManager from "@/components/UserManager";
export default async function UsersPage() { await requirePage(OWNER); return <UserManager />; }
