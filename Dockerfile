FROM node:22-bookworm-slim

# Prisma's SQLite engine requires OpenSSL in the runtime image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN mkdir -p /data

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production \
    DATABASE_URL=file:/data/books.db \
    PORT=3000

EXPOSE 3000

# The database schema is created on the persistent volume before Next.js starts.
CMD ["sh", "-c", "npx prisma db push && exec npm start"]
