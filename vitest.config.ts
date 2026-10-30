import { configDefaults, defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

// Busselton fork: agents' worktrees (.claude/worktrees) and the scratch tools never run with the
// repo's own tests; picking them up made one full run take 40 minutes.
export default mergeConfig(viteConfig, defineConfig({
  test: { testTimeout: 60_000, exclude: [...configDefaults.exclude, ".claude/**", "scripts/tmp/**", "out/**"] },
}));
