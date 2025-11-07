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
    // Provide some manual chunking to separate vendor code (React, UI libs)
    // into their own chunks so they don't inflate the main application bundle.
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules')) {
            if (id.includes('react') || id.includes('react-dom')) return 'vendor-react';
            if (id.includes('@radix-ui') || id.includes('lucide-react') || id.includes('tailwindcss')) return 'vendor-ui';
            return 'vendor';
          }
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
