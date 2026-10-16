/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // three.js & R3F berjalan di client; tidak ada node API di bundle.
  transpilePackages: ['three'],
};

export default nextConfig;
