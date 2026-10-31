// Is any tree (or house, shop, furniture, parked car) standing on water, wetland, sand, a groyne or
// seawall, a jetty, or the shore strip? (src/core/shoreCheck.ts)
//   npx tsx scripts/check/shore_check.ts out/<slug>.zip [--mask <dir with shore_mask.png/.ini>] [--json out/<slug>.shore.json]
//
// Reads the main kn5 and every landmark layer (lm_*.kn5) in the zip, and the build's own
// extension/shore_mask.png (or --mask). Without a mask (builds before 31 Oct) only the sea, the rocks
// and the jetties are known. Exits non-zero when a tree stands on any of it, or anything else stands
// on the sea, water, wetland or a groyne.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { readKn5 } from "../../src/core/kn5";
import { decodeOwnPng } from "../../src/core/png";
import { checkShore, type ShoreMaskData } from "../../src/core/shoreCheck";

const args = process.argv.slice(2);
const zipPath = args.find((a) => !a.startsWith("--") && a.endsWith(".zip"));
if (!zipPath) throw new Error("usage: shore_check.ts <zip> [--mask dir] [--json file]");
const opt = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

const files = unzipSync(new Uint8Array(readFileSync(zipPath)), {
  filter: (f) => f.name.endsWith(".kn5") || /\/extension\/shore_mask\.(png|ini)$/.test(f.name),
});
const slug = Object.keys(files)[0].split("/")[0];
const main = files[`${slug}/${slug}.kn5`];
if (!main) throw new Error(`no ${slug}/${slug}.kn5 in ${zipPath}`);
const layers = Object.keys(files).filter((f) => /\/lm_[^/]+\.kn5$/.test(f)).sort();
const models = [readKn5(main).root, ...layers.map((f) => readKn5(files[f]).root)];

const maskDir = opt("--mask");
const png = maskDir ? new Uint8Array(readFileSync(join(maskDir, "shore_mask.png"))) : files[`${slug}/extension/shore_mask.png`];
const ini = maskDir ? readFileSync(join(maskDir, "shore_mask.ini"), "utf8") : files[`${slug}/extension/shore_mask.ini`] && strFromU8(files[`${slug}/extension/shore_mask.ini`]);
let mask: ShoreMaskData | undefined;
if (png && ini) {
  const v = (k: string) => (ini.match(new RegExp(`^\\s*${k}\\s*=\\s*(.*)$`, "m"))?.[1] ?? "").trim();
  const img = decodeOwnPng(png);
  const h = Number(v("HEIGHT"));
  mask = {
    x0: Number(v("X0")), y0: Number(v("Y0")), cell: Number(v("CELL")), w: Number(v("WIDTH")), h,
    classes: v("CLASSES").split(","),
    // Row 0 of the picture is the top (maxY).
    value: (c, r) => img.rgba[((h - 1 - r) * img.width + c) * 4],
  };
}

const r = checkShore(models, mask);
console.log(`shore: ${r.trees} trees, ${r.others} other pieces checked (${layers.length} landmark layers); mask ${mask ? `${mask.w} x ${mask.h} at ${mask.cell} m` : "none: sea, rocks and jetties only"}`);
for (const [where, n] of Object.entries(r.byWhere).sort()) console.log(`  on ${where.padEnd(8)} trees ${String(n.trees).padStart(5)}, others ${n.others}`);
for (const h of r.hits.filter((x) => x.fails).slice(0, 15)) console.log(`  ${h.kind.padEnd(5)} on ${h.where.padEnd(8)} ${h.mesh.padEnd(26)} at x ${h.x.toFixed(1)}, z ${(-h.y).toFixed(1)}`);
console.log(`trees on the shore: ${r.hits.filter((x) => x.fails && x.kind === "tree").length}`);
console.log(`other scenery on water: ${r.hits.filter((x) => x.fails && x.kind !== "tree").length}`);
const json = opt("--json");
if (json) writeFileSync(json, JSON.stringify(r, null, 1));
if (r.failed) {
  console.log(`FAIL: ${r.failed} on water, sand, rocks, jetties or the shore strip`);
  process.exit(1);
}
console.log("ok: nothing on the water or the sand");
