// Vite serves the headless build page (scripts/headless/build-track.mjs) and, in CI only, builds it.
import { defineConfig } from "vite";

const notWatched = ["**/.claude/**", "**/out/**", "**/docs/**", "**/routes/**", "**/scripts/tmp/**"];

export default defineConfig({
  // Relative paths so the CI build works from any folder.
  base: "./",
  build: {
    target: "es2022",
    // three.js makes one large chunk; that's fine for a page nobody downloads.
    chunkSizeWarningLimit: 1500,
  },
  // Worktrees, build output, docs and routes change during a build; none of them may reload the page.
  server: { watch: { ignored: notWatched } },
});
