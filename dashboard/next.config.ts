import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Silences a workspace-root inference warning — this repo has two
  // package-lock.json files (root backend + this dashboard), and Turbopack
  // needs telling explicitly which one is this app's own root.
  turbopack: {
    root: path.join(__dirname),
  },
  // Default 1MB is too small for document uploads (Settings > Documents) —
  // a menu/catalog PDF or spreadsheet easily exceeds that. Matches the
  // backend's own raised Fastify bodyLimit (server.ts) for the same reason.
  experimental: {
    serverActions: {
      bodySizeLimit: "15mb",
    },
  },
};

export default nextConfig;
