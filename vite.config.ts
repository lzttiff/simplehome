import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
// Removed Replit-specific plugins to keep the project Replit-agnostic.

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    // Increase the chunk warning threshold to reduce noisy warnings for
    // moderately large bundles. Long-term you should split code via
    // dynamic import() or tune `manualChunks` for your app's needs.
    chunkSizeWarningLimit: 800,
    // Safer vendor chunking: match exact packages to avoid chunk cycles.
    // In particular, keep only core React runtime packages in `vendor-react`.
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          // Keep Rollup/CommonJS runtime helpers in the React chunk so
          // vendor chunks depend on React, not the other way around.
          if (id.includes("commonjsHelpers.js") || id.includes("\\0commonjsHelpers")) {
            return "vendor-react";
          }

          if (!id.includes("node_modules")) return;

          const isPkg = (name: string) =>
            id.includes(`/node_modules/${name}/`) || id.includes(`\\node_modules\\${name}\\`);

          if (isPkg("react") || isPkg("react-dom") || isPkg("scheduler")) {
            return "vendor-react";
          }

          if (isPkg("@radix-ui") || isPkg("vaul") || isPkg("cmdk")) {
            return "vendor-ui";
          }

          if (isPkg("@tanstack") || isPkg("wouter") || isPkg("react-hook-form") || isPkg("@hookform")) {
            return "vendor-app";
          }

          return "vendor";
        },
      },
    },
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
    // Enable polling for environments where file system events are not delivered
    // reliably (WSL, network mounts, some container editors). Polling is slightly
    // less efficient but makes Hot Module Replacement (HMR) more reliable.
    watch: {
      usePolling: true,
      interval: 100,
    },
  },
});
