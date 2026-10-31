import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset paths, so the build works from any static host or subfolder
  // (GitHub Pages, Netlify, or straight off disk via `vite preview`).
  base: "./",
  build: { target: "es2022", chunkSizeWarningLimit: 1200 },
  // Busselton fork: agents' worktrees, build output and docs never reload a running headless build's page.
  server: { watch: { ignored: ["**/.claude/**", "**/out/**", "**/docs/**", "**/routes/**", "**/scripts/tmp/**"] } },
});
