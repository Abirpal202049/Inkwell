import path from "node:path";
import type { NextConfig } from "next";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  // Docker deploy (docker-compose.prod.yml): self-contained server output.
  output: "standalone",
  // npm-workspaces monorepo — trace from the repo root so hoisted
  // node_modules land in .next/standalone.
  outputFileTracingRoot: path.join(__dirname, ".."),
  // Pure reverse proxy to the standalone backend (plan/01): keeps the
  // Auth.js session cookie first-party. No backend logic lives in Next.
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${BACKEND_URL}/api/:path*` },
    ];
  },
};

export default nextConfig;
