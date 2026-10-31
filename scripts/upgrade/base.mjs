// Base upgrades as a deliberate step (ROADMAP.md, generate-freeze-polish, A3). A showcase track's base
// changes only this way: rebuilt from its frozen inputs, checked, compared with the accepted base,
// then accepted or rolled back. Its polish (landmark layers) sits on fixed coordinates and carries over.
//
//   node scripts/upgrade/base.mjs build <route.json> [--snapshot <dir>]
//       Builds the track (from its snapshot when it has one: the one named in its folder's
//       snapshot.json, under out/snapshots/), renders the standard views (SHOTS=auto), runs every
//       check (scripts/check/all.mjs) and writes out/<slug>.upgrade.md: what changed against the
//       accepted base (checks, triangles, AI, renders in out/<slug>.compare.png).
//   node scripts/upgrade/base.mjs accept <route.json>
//       The current build becomes the accepted base: out/accepted/<slug>.zip, its renders saved for the
//       next comparison, and the track folder's base.json updated (date, commit, snapshot, checks).
//   node scripts/upgrade/base.mjs rollback <route.json>
//       Puts the accepted base back in out/<slug>.zip.

import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const [cmd, routeArg] = process.argv.slice(2);
const flag = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
if (!cmd || !routeArg) throw new Error("usage: base.mjs build|accept|rollback <route.json> [--snapshot <dir>]");
const routePath = resolve(root, routeArg);
const route = JSON.parse(readFileSync(routePath, "utf8"));
// The same rule as slugify() in src/core/acFiles.ts: trim, cut to 40, trim again; real_road when empty.
const trimUnderscores = (s) => s.replace(/^_+|_+$/g, "");
const slug = trimUnderscores(trimUnderscores(route.name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_")).slice(0, 40)) || "real_road";
// Private tracks keep their folder under routes/private (gitignored), public ones under tracks/.
const isPrivate = routePath.includes(`${join("routes", "private")}`);
const trackDir = join(root, isPrivate ? join("routes", "private", "tracks") : "tracks", slug);
const accepted = join(root, "out", "accepted");
const sh = (c, a, env = {}) => execFileSync(c, a, { cwd: root, stdio: "inherit", env: { ...process.env, ...env } });
const readJson = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null);

if (cmd === "build") {
  const manifest = readJson(join(trackDir, "snapshot.json"));
  const snapshot = flag("--snapshot") ?? (manifest ? join(root, "out", "snapshots", manifest.snapshot) : null);
  if (snapshot && !existsSync(snapshot)) throw new Error(`the snapshot ${snapshot} isn't here: unzip it from the share's snapshots folder into out/snapshots/`);
  console.log(snapshot ? `building ${slug} from ${snapshot}` : `building ${slug} from live data (no snapshot yet: make one with scripts/snapshot/snapshot.mjs make ${slug})`);
  sh("node", ["scripts/headless/build-track.mjs", routeArg], { SHOTS: "auto", ...(snapshot ? { SNAPSHOT: snapshot } : {}) });
  const checks = spawnSync("node", ["scripts/check/all.mjs", slug, "--json", `out/${slug}.checks.json`], { cwd: root, encoding: "utf8", maxBuffer: 64 << 20 });
  const now = readJson(join(root, "out", `${slug}.checks.json`));
  const before = readJson(join(accepted, `${slug}.checks.json`));
  const diff = spawnSync("python3", ["-I", "scripts/check/render_diff.py", slug], { cwd: root, encoding: "utf8" });
  const rows = [];
  const keys = ["passed", "triangles", "drawCalls", "demWithin95", "spikes", "maxTilt", "edgeMedianCm", "kinks10", "groundThroughStreetsCm", "trafficOverlaps", "trafficLooseEnds"];
  for (const k of keys) if (now?.[k] !== undefined || before?.[k] !== undefined) rows.push(`| ${k} | ${before?.[k] ?? "-"} | ${now?.[k] ?? "-"} |`);
  for (const [l, v] of Object.entries(now?.aiOffRoad ?? {})) rows.push(`| AI off the road, ${l} (%) | ${before?.aiOffRoad?.[l] ?? "-"} | ${v} |`);
  const md = [
    `# Base upgrade: ${route.name}`, "",
    `Built ${new Date().toISOString().slice(0, 16)} from ${snapshot ? `the snapshot ${manifest?.snapshot ?? snapshot}` : "live data"}, commit ${execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).trim()}.`,
    before ? `Compared with the accepted base of ${before.when.slice(0, 10)}.` : "No accepted base yet: accept this one to start.", "",
    `**Checks: ${now?.passed ? "all pass" : `FAILED: ${now?.failed?.join(", ")}`}**`, "",
    "| | accepted | this build |", "| --- | --- | --- |", ...rows, "",
    `Renders: ${diff.status === 0 ? `out/${slug}.compare.png (before, after, changed)` : "no saved renders to compare with yet (accept saves them)"}.`,
    diff.stdout?.trim() ? `\n\`\`\`\n${diff.stdout.trim().slice(-1500)}\n\`\`\`` : "", "",
    `Accept: node scripts/upgrade/base.mjs accept ${routeArg}`, `Roll back: node scripts/upgrade/base.mjs rollback ${routeArg}`, "",
  ].join("\n");
  writeFileSync(join(root, "out", `${slug}.upgrade.md`), md);
  console.log(`\n${md}`);
  process.exit(checks.status === 0 ? 0 : 1);
} else if (cmd === "accept") {
  const now = readJson(join(root, "out", `${slug}.checks.json`));
  if (!now) throw new Error(`no checks for out/${slug}.zip: run "base.mjs build" first`);
  if (!now.passed && !process.argv.includes("--force")) throw new Error(`the build failed ${now.failed.join(", ")}: fix it, or accept anyway with --force`);
  mkdirSync(accepted, { recursive: true });
  for (const ext of ["zip", "checks.json", "inputs.json", "stats.json"]) {
    const f = join(root, "out", `${slug}.${ext}`);
    if (existsSync(f)) copyFileSync(f, join(accepted, `${slug}.${ext}`));
  }
  spawnSync("python3", ["-I", "scripts/check/render_diff.py", slug, "--save"], { cwd: root, stdio: "inherit" });
  mkdirSync(trackDir, { recursive: true });
  const inputs = readJson(join(root, "out", `${slug}.inputs.json`));
  const base = readJson(join(trackDir, "base.json")) ?? { history: [] };
  const entry = {
    accepted: new Date().toISOString().slice(0, 10),
    commit: execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    snapshot: inputs?.snapshot ?? null,
    triangles: now.triangles, aiOffRoad: now.aiOffRoad ?? null, passed: now.passed,
  };
  base.current = entry;
  base.history = [entry, ...(base.history ?? [])].slice(0, 20);
  writeFileSync(join(trackDir, "base.json"), JSON.stringify(base, null, 1));
  console.log(`accepted ${slug}: out/accepted/${slug}.zip; ${join(trackDir, "base.json")}`);
} else if (cmd === "rollback") {
  const z = join(accepted, `${slug}.zip`);
  if (!existsSync(z)) throw new Error(`no accepted base for ${slug}`);
  copyFileSync(z, join(root, "out", `${slug}.zip`));
  for (const ext of ["checks.json", "stats.json", "inputs.json"]) if (existsSync(join(accepted, `${slug}.${ext}`))) copyFileSync(join(accepted, `${slug}.${ext}`), join(root, "out", `${slug}.${ext}`));
  console.log(`out/${slug}.zip is the accepted base again`);
} else {
  throw new Error(`unknown command ${cmd}`);
}
