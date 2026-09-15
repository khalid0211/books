import BookForm from "@/components/BookForm";
import { requirePage, WRITE } from "@/lib/auth";

export default async function NewBookPage() {
  await requirePage(WRITE);
  return <BookForm />;
}
