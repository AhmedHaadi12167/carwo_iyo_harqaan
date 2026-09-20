/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 'standalone' bundles the frontend into a single runnable server —
  // required for packaging the desktop (.exe) version
  output: 'standalone',
};

export default nextConfig;
