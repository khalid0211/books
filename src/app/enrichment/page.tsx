import { OWNER, requirePage } from "@/lib/auth";
import EnrichmentManager from "@/components/EnrichmentManager";
export default async function EnrichmentPage() {
  await requirePage(OWNER);
  return <EnrichmentManager />;
}
