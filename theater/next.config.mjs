/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // E2E memakai `next dev` di project yang sama dengan dev server utama.
  // Pisahkan output dir agar E2E tidak menimpa `.next` milik dev server
  // (gejala: UI :3001 tiba-tiba menembak port E2E 4899).
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // three.js & R3F berjalan di client; tidak ada node API di bundle.
  transpilePackages: ['three'],
  // Image produksi (theater/Dockerfile) memakai output standalone — server.js
  // minimal + node_modules hasil tracing. `next dev` tidak terpengaruh.
  output: 'standalone',
};

export default nextConfig;
