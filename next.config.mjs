/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep a production build from replacing chunks used by a running dev server.
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
};

export default nextConfig;
