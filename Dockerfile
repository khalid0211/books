FROM node:22-bookworm-slim

# Prisma's SQLite engine requires OpenSSL in the runtime image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN mkdir -p /data

COPY package.json package-lock.json ./
COPY prisma/schema.prisma ./prisma/schema.prisma
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production \
    DATABASE_URL=file:/data/books.db \
    REQUIRE_EXISTING_DATABASE=true \
    PORT=3000

EXPOSE 3000

# Initialize the persistent database and starter categories before Next.js starts.
CMD ["sh", "-c", "node scripts/prepare-production-db.cjs && node node_modules/prisma/build/index.js db push && node scripts/seed-categories.cjs && exec npm start"]
