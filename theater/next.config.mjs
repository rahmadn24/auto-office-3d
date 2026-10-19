/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // three.js & R3F berjalan di client; tidak ada node API di bundle.
  transpilePackages: ['three'],
  // Image produksi (theater/Dockerfile) memakai output standalone — server.js
  // minimal + node_modules hasil tracing. `next dev` tidak terpengaruh.
  output: 'standalone',
};

export default nextConfig;
