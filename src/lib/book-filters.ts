import { bookNumber, type Book } from "./books";

type Filters = { bookType?: string; category?: string; owner?: string; format: string; location: string; rating: string; author: string; language: string };
export function filterBooks(books: Book[], query: string, filters: Filters, sort: string, direction: string) {
  const q = query.trim().toLocaleLowerCase();
  const result = books.filter((b) => {
    if (q && ![bookNumber(b.id), b.title, b.authors, b.isbn10, b.isbn13, b.tags, b.owner?.name, b.publisher, b.shelfLocation, b.bookType, ...(b.categories || []).map((c) => c.name)].some((v) => v?.toLocaleLowerCase().includes(q))) return false;
    if (filters.owner === "__none" ? b.ownerId != null : filters.owner && String(b.ownerId) !== filters.owner) return false;
    if (filters.bookType === "__none" ? Boolean(b.bookType) : filters.bookType && b.bookType !== filters.bookType) return false;
    if (filters.category === "__none" ? Boolean(b.categories?.length) : filters.category && !b.categories?.some((c) => String(c.id) === filters.category)) return false;
    if (filters.format && b.format !== filters.format) return false;
    if (filters.location === "__none" ? Boolean(b.shelfLocation) : filters.location && b.shelfLocation !== filters.location) return false;
    if (filters.author && b.authors !== filters.author) return false;
    if (filters.language && b.language !== filters.language) return false;
    if (filters.rating === "unrated" ? b.rating !== null : filters.rating && (b.rating === null || b.rating < Number(filters.rating))) return false;
    return true;
  });
  const key = (["id", "title", "authors", "createdAt", "publicationDate", "rating", "shelfLocation"].includes(sort) ? sort : "createdAt") as keyof Book;
  return result.sort((a, b) => {
    const av = a[key], bv = b[key];
    // Missing metadata stays last in either direction.
    if (av === null || av === "") return bv === null || bv === "" ? a.id - b.id : 1;
    if (bv === null || bv === "") return -1;
    const comparison = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" });
    return comparison ? comparison * (direction === "asc" ? 1 : -1) : a.id - b.id;
  });
}
