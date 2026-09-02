import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Silences a workspace-root inference warning — this repo has two
  // package-lock.json files (root backend + this dashboard), and Turbopack
  // needs telling explicitly which one is this app's own root.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
