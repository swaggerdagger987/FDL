import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@app": path.resolve(__dirname, "./app"),
      "@pages": path.resolve(__dirname, "./pages"),
      "@shared": path.resolve(__dirname, "./shared"),
      "@features": path.resolve(__dirname, "./features")
    }
  },
  base: "/v2/",
  build: {
    outDir: "dist"
  }
});
