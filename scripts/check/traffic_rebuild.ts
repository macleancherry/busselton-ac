// Rebuild a track's traffic graph from what the build saved (out/<slug>.traffic-input.json) and
// put it back in the zip, for working on traffic.ts without rebuilding the whole track.
//
//   npx tsx scripts/check/traffic_rebuild.ts out/<slug>.traffic-input.json out/<slug>.zip [kids]
//
// Every layout's traffic.json is rewritten (in the kids' setting with "kids").
// Then: python3 -I scripts/check/traffic_check.py out/<slug>.zip out/<slug>.surface.json

import { readFileSync, writeFileSync } from "node:fs";
import { unzipSync, zipSync } from "fflate";
import { trafficJson } from "../../src/core/traffic";

const input = JSON.parse(readFileSync(process.argv[2], "utf8"));
const files = unzipSync(new Uint8Array(readFileSync(process.argv[3])));
const setting = process.argv[4] === "kids" ? "kids" : "normal";
const text = new TextEncoder().encode(trafficJson(input.roads, input.roundabouts, setting));
const names = Object.keys(files).filter((f) => f.endsWith("data/traffic.json"));
for (const name of names) files[name] = text;
writeFileSync(process.argv[3], zipSync(files, { level: 1 }));
console.log(`rewrote ${names.join(", ")} (${setting})`);
