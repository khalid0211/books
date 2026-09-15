export type CategoryChoice = { id: number; name: string };
export type Classification = { bookType: string | null; categoryIds: number[] };
export const BOOK_TYPES = ["Fiction", "Non-fiction"];
export const STARTER_CATEGORIES = ["Biography", "Science", "History", "Religion", "Philosophy", "Business", "Technology", "Psychology", "Self-help", "Travel", "Art", "Poetry", "Mystery", "Fantasy", "Science Fiction", "Romance", "Thriller", "Children’s Books"];

/** Conservative suggestions only: never infer from a title or mutate a saved choice. */
export function suggestClassification(subjects: string[], categories: CategoryChoice[]): Classification {
  const text = subjects.join(" | ").toLowerCase().replace(/[_/]/g, " ");
  const rules: Record<string, RegExp> = {
    biography: /\b(biograph\w*|autobiograph\w*|memoirs?)\b/,
    science: /\b(physics|chemistry|biology|astronomy|scientific|natural sciences?)\b/,
    history: /\b(history|historical studies)\b/,
    religion: /\b(religion|religious|islam|christianity|buddhism|hinduism)\b/,
    philosophy: /\bphilosoph\w*\b/, business: /\b(business|management|economics|finance)\b/,
    technology: /\b(technology|computers?|programming|engineering)\b/,
    psychology: /\bpsycholog\w*\b/, "self-help": /\b(self[- ]help|personal development)\b/,
    travel: /\btravel\w*\b/, art: /\b(art|painting|sculpture)\b/,
    poetry: /\bpoetry\b/, mystery: /\b(mystery|detective)\b/, fantasy: /\bfantasy\b/,
    "science fiction": /\bscience fiction\b/, romance: /\bromance\b/, thriller: /\bthrillers?\b/,
    "children’s books": /\b(juvenile|children's|children’s)\b/,
  };
  const categoryIds = categories.filter(({ name }) => {
    const key = name.toLowerCase();
    if (key === "science" && /\bscience\b/.test(text.replace(/science fiction/g, ""))) return true;
    return rules[key]?.test(text) || subjects.some((s) => s.trim().toLowerCase() === key);
  }).map((c) => c.id);
  const nonfiction = /\b(non[- ]?fiction|biograph\w*|autobiograph\w*|memoirs?)\b/.test(text);
  const fiction = /\b(fiction|novels?)\b/.test(text.replace(/non[- ]?fiction/g, ""));
  return { bookType: fiction === nonfiction ? null : fiction ? "Fiction" : "Non-fiction", categoryIds };
}
