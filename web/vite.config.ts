import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In dev, /api and the session socket go to wrangler dev; in production the Worker serves dist/.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { "/api": { target: "http://127.0.0.1:8787", ws: true } },
  },
});
