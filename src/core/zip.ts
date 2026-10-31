// Packs a built track (path -> bytes) into one ZIP for Content Manager and install-track.ps1.
// Written from docs/specs/zip.md. Compression is fflate's; this module picks the level per file.
//
// Limits: no ZIP64 (fflate's sync zipper doesn't write it), so no entry or archive over 4 GiB
// and at most 65535 entries. Current builds are a few hundred MB and a few hundred entries.

import { zipSync, type Zippable } from "fflate";

/** Already compressed (PNG, JPEG) or mostly embedded PNG data (kn5): stored, not deflated. */
const STORED = /\.(png|jpg|kn5)$/i;
const DEFLATE_LEVEL = 6;
/**
 * Fixed entry timestamp, so identical builds zip to identical bytes. Built from local date
 * parts because fflate writes the DOS time from local getters: 1 Jan 2020 00:00 in any zone.
 */
const MTIME = new Date(2020, 0, 1, 0, 0, 0);

/** One entry per key, in key order, names exactly as given. */
export function zipTrack(files: Record<string, Uint8Array>): Uint8Array {
  const entries: Zippable = {};
  for (const [name, data] of Object.entries(files)) {
    entries[name] = [data, { level: STORED.test(name) ? 0 : DEFLATE_LEVEL, mtime: MTIME }];
  }
  return zipSync(entries);
}
