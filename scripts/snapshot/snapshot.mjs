// Per-track input snapshots (ROADMAP.md, generate-freeze-polish, A2): the downloads a build used
// (map tiles, Overpass, imagery, heights, routing, Mapillary), frozen so the track's base rebuilds
// offline and the same every time.
//
//   node scripts/snapshot/snapshot.mjs make <slug> [--manifest <path>]
//       From the last build's out/<slug>.inputs.json and the download cache (out/cache): copies the
//       entries into out/snapshots/<slug>-<date>/ and writes the manifest (keys, sizes, sha256; no
//       URLs, since some carry API tokens) to --manifest (default tracks/<slug>/snapshot.json).
//   node scripts/snapshot/snapshot.mjs check <dir> [--manifest <path>]
//       Every entry the manifest lists is in the snapshot and unchanged.
//   node scripts/snapshot/snapshot.mjs zip <dir>
//       out/snapshots/<name>.zip, for the share's snapshots\ folder (the imagery is personal use only,
//       so snapshots never go in the repo).
//
// Build from one:  SNAPSHOT=out/snapshots/<slug>-<date> node scripts/headless/build-track.mjs <route>

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const [cmd, arg] = process.argv.slice(2);
const flag = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const cache = process.env.BUILD_CACHE ?? join(root, "out", "cache");

if (cmd === "make") {
  const inputs = JSON.parse(readFileSync(join(root, "out", `${arg}.inputs.json`), "utf8"));
  const date = new Date().toISOString().slice(0, 10);
  const dir = join(root, "out", "snapshots", `${arg}-${date}`);
  mkdirSync(dir, { recursive: true });
  const entries = [];
  let bytes = 0, missing = 0;
  for (const key of inputs.keys) {
    const b = join(cache, `${key}.bin`), m = join(cache, `${key}.json`);
    if (!existsSync(b) || !existsSync(m)) { missing++; continue; }
    copyFileSync(b, join(dir, `${key}.bin`));
    copyFileSync(m, join(dir, `${key}.json`));
    const size = readFileSync(b).length;
    bytes += size;
    entries.push([key, size, sha(b)]);
  }
  const manifest = {
    note: "A frozen copy of the downloads this track's base was built from (scripts/snapshot/snapshot.mjs). The files live in the share's snapshots folder, not here.",
    track: arg, route: inputs.route, made: date, snapshot: basename(dir), hosts: inputs.hosts,
    count: entries.length, bytes, entries,
  };
  const mpath = resolve(root, flag("--manifest") ?? join("tracks", arg, "snapshot.json"));
  mkdirSync(dirname(mpath), { recursive: true });
  writeFileSync(mpath, JSON.stringify(manifest, null, 0).replace(/\],\[/g, "],\n["));
  writeFileSync(join(dir, "snapshot.json"), JSON.stringify(manifest));
  console.log(`${dir}: ${entries.length} downloads, ${(bytes / 1e6).toFixed(1)} MB${missing ? `; ${missing} were no longer in the cache (rebuild first)` : ""}; manifest ${mpath}`);
  if (missing) process.exitCode = 1;
} else if (cmd === "check") {
  const dir = resolve(arg);
  const manifest = JSON.parse(readFileSync(flag("--manifest") ? resolve(flag("--manifest")) : join(dir, "snapshot.json"), "utf8"));
  let bad = 0;
  for (const [key, size, hash] of manifest.entries) {
    const b = join(dir, `${key}.bin`);
    if (!existsSync(b) || !existsSync(join(dir, `${key}.json`))) { bad++; continue; }
    if (readFileSync(b).length !== size || sha(b) !== hash) bad++;
  }
  console.log(`${dir}: ${manifest.entries.length - bad} of ${manifest.entries.length} downloads present and unchanged`);
  if (bad) process.exitCode = 1;
} else if (cmd === "zip") {
  const dir = resolve(arg);
  const files = {};
  for (const f of readdirSync(dir)) files[`${basename(dir)}/${f}`] = new Uint8Array(readFileSync(join(dir, f)));
  const out = join(root, "out", "snapshots", `${basename(dir)}.zip`);
  writeFileSync(out, zipSync(files, { level: 0 }));
  console.log(`wrote ${out}`);
} else {
  console.log("usage: snapshot.mjs make <slug> | check <dir> | zip <dir>");
  process.exitCode = 2;
}
