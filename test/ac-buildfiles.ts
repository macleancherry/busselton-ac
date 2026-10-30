// Shared by the AC format tests: the files inside a real build zip, when one is present.
// Path from AC_BUILD_ZIP, defaulting to out/accepted/busselton.zip. Tests using it skip when absent.
import { existsSync, readFileSync } from "node:fs";
import { unzipSync } from "fflate";

export const BUILD_ZIP = process.env.AC_BUILD_ZIP ?? "out/accepted/busselton.zip";
export const HAVE_BUILD = existsSync(BUILD_ZIP);

let cache: Record<string, Uint8Array> | undefined;

/** Files in the build zip whose names pass `want` (read lazily, once). */
export function buildFiles(want: (name: string) => boolean): Record<string, Uint8Array> {
  if (!cache) cache = unzipSync(new Uint8Array(readFileSync(BUILD_ZIP)), { filter: (f) => /\.(kn5|ai|png)$/.test(f.name) });
  return Object.fromEntries(Object.entries(cache).filter(([n]) => want(n)));
}
