import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset paths, so the production build (CI only) works from any folder.
  base: "./",
  build: { target: "es2022", chunkSizeWarningLimit: 1200 },
  // Busselton fork: agents' worktrees, build output and docs never reload a running headless build's page.
  server: { watch: { ignored: ["**/.claude/**", "**/out/**", "**/docs/**", "**/routes/**", "**/scripts/tmp/**"] } },
});
