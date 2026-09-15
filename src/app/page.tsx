import BookList from "@/components/BookList";
import { requirePage } from "@/lib/auth";

export default async function HomePage() {
  const user = await requirePage();
  return <BookList canEdit={user.role !== "VIEW"} canDelete={user.role === "OWNER"} />;
}
