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
