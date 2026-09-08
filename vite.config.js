import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";
import apiPlugin from "./api/plugin.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // Vite refuses any hostname it was not told about, so HOST in .env lists the
  // public name(s) the page is served from. Empty is local development, where
  // Vite's own localhost default applies.
  const allowedHosts = (env.HOST ?? "")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);

  return {
    // The account check answers under /api on this same server, in
    // development and in preview alike: one port, nothing proxied.
    plugins: [react(), apiPlugin(env)],
    // A taken port fails loudly instead of quietly moving to the next one,
    // where the reverse proxy would find nothing.
    server: {
      allowedHosts,
      strictPort: true,
    },
    preview: {
      allowedHosts,
      strictPort: true,
    },
    resolve: {
      alias: {
        "@components": path.resolve(__dirname, "src/components"),
        "@pages": path.resolve(__dirname, "src/pages"),
        "@utils": path.resolve(__dirname, "src/utils"),
      },
    },
  };
});
