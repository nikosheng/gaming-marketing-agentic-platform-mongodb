/**
 * Next.js configuration.
 *
 * The former `app/api/**` routes are gone — all backend logic now lives in
 * the Python FastAPI service under `server/`. In dev this rewrite proxies
 * `/api/*` from the browser to that service, so the UI's fetch calls stay
 * unchanged.
 *
 * Override the backend URL for prod/staging by setting
 * `NEXT_PUBLIC_BACKEND_URL` (e.g. https://api.example.com) at build time.
 */

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    const backend =
      process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";
    return [
      {
        source: "/api/:path*",
        destination: `${backend}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
