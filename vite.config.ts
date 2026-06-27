import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import {cloudflare} from "@cloudflare/vite-plugin";

export default defineConfig({
  vite: {
    plugins: [cloudflare()],
  },
});