import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const target = process.env.VITE_PROXY_TARGET ?? "http://localhost:4100";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      "/api": target,
      "/collab": { target: target.replace(/^http/, "ws"), ws: true },
    },
  },
  test: { environment: "jsdom" },
} as any);
