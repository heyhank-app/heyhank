import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174,
    proxy: {
      "/api": "http://localhost:3456",
      "/ws": {
        target: "ws://localhost:3456",
        ws: true,
      },
    },
  },
});
