/** @type {import('next').NextConfig} */

// FFmpeg.wasm needs SharedArrayBuffer, which the browser only exposes in a
// "cross-origin isolated" context. That requires these two response headers on
// every document/worker. Vercel serves these headers from this config in prod.
const crossOriginIsolationHeaders = [
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
];

const nextConfig = {
  reactStrictMode: true,
  // Don't block production builds on lint warnings — render correctness is
  // validated at runtime, not by the linter.
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: crossOriginIsolationHeaders,
      },
    ];
  },
  // The ffmpeg core is fetched from a CDN at runtime and run from a Blob URL,
  // so we don't bundle the wasm. Nothing extra needed in webpack here.
};

module.exports = nextConfig;
