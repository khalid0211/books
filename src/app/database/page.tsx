import DatabaseManager from "@/components/DatabaseManager";
import { OWNER, requirePage } from "@/lib/auth";

export default async function DatabasePage() {
  await requirePage(OWNER);
  return <DatabaseManager />;
}
