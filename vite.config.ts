import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The workload UI lives in web/ and reuses the browser-safe engine from src/.
export default defineConfig({
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
