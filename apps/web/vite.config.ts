import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/_local/cognito": {
        target: "http://localhost:4566",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/_local\/cognito/, "") || "/",
      },
    },
  },
  build: { sourcemap: true },
});
