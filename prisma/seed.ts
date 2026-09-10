import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const sample = [
  {
    title: "The Pragmatic Programmer",
    authors: "Andrew Hunt, David Thomas",
    isbn13: "9780135957059",
    publisher: "Addison-Wesley",
    publicationDate: "2019-09-13",
    edition: "20th Anniversary Edition",
    language: "English",
    pageCount: 352,
    tags: "software, craft",
    format: "hardcover",
    shelfLocation: "A1",
    rating: 5,
  },
  {
    title: "Clean Code",
    authors: "Robert C. Martin",
    isbn13: "9780132350884",
    publisher: "Prentice Hall",
    publicationDate: "2008-08-01",
    language: "English",
    pageCount: 464,
    tags: "software",
    format: "paperback",
    shelfLocation: "A2",
    rating: 4,
  },
  {
    title: "Sapiens: A Brief History of Humankind",
    authors: "Yuval Noah Harari",
    isbn13: "9780062316097",
    publisher: "Harper",
    publicationDate: "2015-02-10",
    language: "English",
    pageCount: 464,
    tags: "history, anthropology",
    format: "paperback",
    shelfLocation: "C3",
    rating: 5,
  },
];

async function main() {
  for (const book of sample) {
    await prisma.book.create({ data: book });
  }
  console.log(`Seeded ${sample.length} books.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
