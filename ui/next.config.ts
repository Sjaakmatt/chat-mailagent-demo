import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // De repo heeft twee lockfiles (root npm-app + deze aios pnpm-workspace).
  // Pin de tracing-root op de aios-workspace (de parent), zó dat hij overeenkomt
  // met OpenNext's eigen monorepo-detectie (via aios/pnpm-workspace.yaml). Anders
  // zoekt OpenNext de standalone-output op het verkeerde pad (ENOENT).
  outputFileTracingRoot: path.join(dir, ".."),

  // Lint hoort in de CI-stap, niet in de deploy-build. Zonder dit probeert
  // `next build` ESLint te installeren/configureren en hangt het op een
  // interactieve prompt op de runner (→ SIGTERM). Typecheck blijft wel hard.
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
