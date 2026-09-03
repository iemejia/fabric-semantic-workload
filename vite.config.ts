import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The workload UI lives in web/ and reuses the browser-safe engine from src/.
//
// PAGES_BASE lets the same build target different roots:
//   - "/" (default) for local dev and the Fabric DevServer (localhost:60006)
//   - "/fabric-semantic-workload/" for the GitHub Pages project site
export default defineConfig({
  base: process.env.PAGES_BASE ?? "/",
  root: "web",
  plugins: [react()],
  server: {
    // Allow importing the engine (../src) and sample (../samples) from web/.
    fs: { allow: [".."] },
  },
  build: {
    outDir: "../dist-web",
    emptyOutDir: true,
  },
});
