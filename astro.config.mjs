import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import tailwind from "@tailwindcss/vite";
import cloudflare from "@astrojs/cloudflare";

export default defineConfig({
  output: "hybrid",  // or "server" for full SSR
  adapter: cloudflare(),
  integrations: [react()],
  vite: {
    plugins: [tailwind()],
  },
  site: "https://hazardcleanup.ca", 
});