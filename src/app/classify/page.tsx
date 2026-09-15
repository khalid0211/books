import { requirePage, WRITE } from "@/lib/auth";
import ClassifyBooks from "@/components/ClassifyBooks";
export default async function ClassifyPage() {
  await requirePage(WRITE);
  return <ClassifyBooks />;
}
