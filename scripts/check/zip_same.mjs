#!/usr/bin/env node
// Are two track builds the same, entry by entry? (docs/specs/track.md section 15, item 1.)
//
//   node scripts/check/zip_same.mjs <a.zip> <b.zip>
//
// Lists the entries only one zip has, and every entry whose bytes differ. For a kn5 that differs it
// reads both and names the first difference: the texture list, a texture's bytes, the material
// list or a material's fields, then the node tree (path, name, kind, mesh material and flags), then
// the first differing vertex or index, so a failure says which stage of the build moved.
// Exits 0 when every entry is byte-identical, 1 otherwise.
//
// The kn5 reader here is its own small one (no TypeScript), reading the same layout kn5.ts writes.

import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";

class Reader {
  constructor(bytes) {
    this.b = bytes;
    this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.p = 0;
  }
  take(n) {
    const at = this.p;
    if (at + n > this.b.length) throw new RangeError(`kn5 ends early at ${at} (wanted ${n} bytes)`);
    this.p += n;
    return at;
  }
  u8() { return this.b[this.take(1)]; }
  u32() { return this.dv.getUint32(this.take(4), true); }
  i32() { return this.dv.getInt32(this.take(4), true); }
  f32() { return this.dv.getFloat32(this.take(4), true); }
  raw(n) { const at = this.take(n); return this.b.subarray(at, at + n); }
  str() { return new TextDecoder().decode(this.raw(this.u32())); }
  floats(n) { return Array.from({ length: n }, () => this.f32()); }
}

/** A kn5 as plain data; vertex and index runs stay as byte views. */
export function parseKn5(bytes) {
  const r = new Reader(bytes);
  const magic = new TextDecoder().decode(r.raw(6));
  if (magic !== "sc6969") throw new Error("not a kn5 file");
  const version = r.u32();
  if (version > 5) r.take(4);
  const textures = Array.from({ length: r.u32() }, () => {
    r.take(4);
    const name = r.str();
    return { name, data: r.raw(r.u32()) };
  });
  const materials = Array.from({ length: r.u32() }, () => {
    const name = r.str(), shader = r.str(), blendMode = r.u8(), alphaTested = r.u8(), depthMode = r.i32();
    const properties = Array.from({ length: r.u32() }, () => ({ name: r.str(), a: r.f32(), b: r.floats(2), c: r.floats(3), d: r.floats(4) }));
    const textures = Array.from({ length: r.u32() }, () => ({ slot: r.str(), register: r.u32(), texture: r.str() }));
    return { name, shader, blendMode, alphaTested, depthMode, properties, textures };
  });
  const node = () => {
    const cls = r.u32(), name = r.str(), kids = r.u32(), active = r.u8();
    if (cls === 1) {
      const transform = r.floats(16);
      return { kind: "node", name, active, transform, children: Array.from({ length: kids }, node) };
    }
    const flags = [r.u8(), r.u8(), r.u8()];
    const vertexCount = r.u32();
    const vertices = r.raw(vertexCount * 44);
    const indexCount = r.u32();
    const indices = r.raw(indexCount * 2);
    const material = r.u32(), layer = r.u32(), lodIn = r.f32(), lodOut = r.f32();
    const sphere = r.raw(16);
    const renderable = r.u8();
    return { kind: "mesh", name, active, flags, vertexCount, vertices, indexCount, indices, material, layer, lodIn, lodOut, sphere, renderable };
  };
  const root = node();
  if (r.p !== bytes.length) throw new Error(`kn5: ${bytes.length - r.p} bytes after the node tree`);
  return { version, textures, materials, root };
}

const sameBytes = (a, b) => a.length === b.length && Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength));
const firstByte = (a, b) => {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return n;
};
const show = (v) => JSON.stringify(v);

/** The first difference between two kn5 files, in words, or null when they're the same. */
export function diffKn5(aBytes, bBytes) {
  if (sameBytes(aBytes, bBytes)) return null;
  const a = parseKn5(aBytes), b = parseKn5(bBytes);
  if (a.version !== b.version) return `version ${a.version} vs ${b.version}`;
  const tn = (m) => m.textures.map((t) => t.name);
  for (let i = 0; i < Math.max(a.textures.length, b.textures.length); i++) {
    const ta = a.textures[i], tb = b.textures[i];
    if (!ta || !tb || ta.name !== tb.name) {
      return `texture list differs at #${i}: ${ta?.name ?? "(none)"} vs ${tb?.name ?? "(none)"}\n  a: ${tn(a).slice(Math.max(0, i - 2), i + 4).join(", ")}\n  b: ${tn(b).slice(Math.max(0, i - 2), i + 4).join(", ")}`;
    }
  }
  for (let i = 0; i < a.textures.length; i++) {
    if (!sameBytes(a.textures[i].data, b.textures[i].data)) {
      return `texture #${i} ${a.textures[i].name}: data differs (${a.textures[i].data.length} vs ${b.textures[i].data.length} bytes, first at byte ${firstByte(a.textures[i].data, b.textures[i].data)})`;
    }
  }
  for (let i = 0; i < Math.max(a.materials.length, b.materials.length); i++) {
    const ma = a.materials[i], mb = b.materials[i];
    if (!ma || !mb || ma.name !== mb.name) {
      const names = (m) => m.materials.slice(Math.max(0, i - 2), i + 4).map((x) => x.name).join(", ");
      return `material list differs at #${i}: ${ma?.name ?? "(none)"} vs ${mb?.name ?? "(none)"}\n  a: ${names(a)}\n  b: ${names(b)}`;
    }
    for (const key of ["shader", "blendMode", "alphaTested", "depthMode", "properties", "textures"]) {
      if (show(ma[key]) !== show(mb[key])) return `material #${i} ${ma.name}: ${key} differs\n  a: ${show(ma[key])}\n  b: ${show(mb[key])}`;
    }
  }
  const matName = (m, k) => m.materials[k]?.name ?? `#${k}`;
  const walk = (na, nb, path) => {
    const here = `${path}/${na.name}`;
    if (na.name !== nb.name || na.kind !== nb.kind) return `node ${path}: ${na.kind} ${na.name} vs ${nb.kind} ${nb.name}`;
    if (na.active !== nb.active) return `node ${here}: active flag differs`;
    if (na.kind === "node") {
      if (show(na.transform) !== show(nb.transform)) return `node ${here}: transform differs\n  a: ${show(na.transform)}\n  b: ${show(nb.transform)}`;
      const n = Math.max(na.children.length, nb.children.length);
      for (let i = 0; i < n; i++) {
        const ca = na.children[i], cb = nb.children[i];
        if (!ca || !cb) {
          const list = (x) => x.children.slice(Math.max(0, i - 2), i + 3).map((c) => c.name).join(", ");
          return `node ${here}: ${na.children.length} vs ${nb.children.length} children; first missing at #${i} (${ca?.name ?? "(none)"} vs ${cb?.name ?? "(none)"})\n  a: ${list(na)}\n  b: ${list(nb)}`;
        }
        const d = walk(ca, cb, here);
        if (d) return d;
      }
      return null;
    }
    if (matName(a, na.material) !== matName(b, nb.material)) return `mesh ${here}: material ${matName(a, na.material)} vs ${matName(b, nb.material)}`;
    for (const key of ["flags", "layer", "lodIn", "lodOut", "renderable"]) {
      if (show(na[key]) !== show(nb[key])) return `mesh ${here}: ${key} ${show(na[key])} vs ${show(nb[key])}`;
    }
    if (na.vertexCount !== nb.vertexCount) return `mesh ${here}: ${na.vertexCount} vs ${nb.vertexCount} vertices`;
    if (!sameBytes(na.vertices, nb.vertices)) {
      const at = firstByte(na.vertices, nb.vertices), v = Math.floor(at / 44), f = Math.floor((at % 44) / 4);
      const part = f < 3 ? "position" : f < 6 ? "normal" : f < 8 ? "uv" : "tangent";
      const vert = (m) => Array.from(new Float32Array(m.vertices.slice(v * 44, v * 44 + 44).buffer)).map((x) => +x.toFixed(4));
      return `mesh ${here}: vertex ${v} of ${na.vertexCount} differs (${part})\n  a: ${show(vert(na))}\n  b: ${show(vert(nb))}`;
    }
    if (na.indexCount !== nb.indexCount) return `mesh ${here}: ${na.indexCount} vs ${nb.indexCount} indices`;
    if (!sameBytes(na.indices, nb.indices)) return `mesh ${here}: index ${Math.floor(firstByte(na.indices, nb.indices) / 2)} differs`;
    if (!sameBytes(na.sphere, nb.sphere)) return `mesh ${here}: bounding sphere differs`;
    return null;
  };
  return walk(a.root, b.root, "") ?? "same model, different bytes (writer layout?)";
}

/** The first differing line of two text files, or a byte offset for binary ones. */
function diffOther(name, a, b) {
  if (/\.(ini|json|txt|lua|ai\.txt)$/i.test(name)) {
    const la = new TextDecoder().decode(a).split("\n"), lb = new TextDecoder().decode(b).split("\n");
    for (let i = 0; i < Math.max(la.length, lb.length); i++) {
      if (la[i] !== lb[i]) return `line ${i + 1}\n  a: ${(la[i] ?? "(none)").slice(0, 300)}\n  b: ${(lb[i] ?? "(none)").slice(0, 300)}`;
    }
  }
  return `${a.length} vs ${b.length} bytes, first difference at byte ${firstByte(a, b)}`;
}

/**
 * Compares two sets of files (name -> bytes, or name -> () => bytes for lazy reading).
 * Returns { onlyA, onlyB, differ: [{ name, why }] }.
 */
export function compareFiles(a, b) {
  const get = (set, k) => (typeof set[k] === "function" ? set[k]() : set[k]);
  const na = Object.keys(a), nb = Object.keys(b);
  const onlyA = na.filter((k) => !(k in b)), onlyB = nb.filter((k) => !(k in a));
  const differ = [];
  for (const k of na) {
    if (!(k in b)) continue;
    const x = get(a, k), y = get(b, k);
    if (sameBytes(x, y)) continue;
    differ.push({ name: k, why: k.endsWith(".kn5") ? diffKn5(x, y) : diffOther(k, x, y) });
  }
  const orderSame = na.filter((k) => k in b).join("\n") === nb.filter((k) => k in a).join("\n");
  return { onlyA, onlyB, differ, orderSame };
}

function zipEntries(path) {
  const bytes = new Uint8Array(readFileSync(path));
  const names = [];
  unzipSync(bytes, { filter: (f) => { names.push(f.name); return false; } });
  // One entry at a time, so a big kn5 pair is the most held in memory at once.
  return Object.fromEntries(names.filter((n) => !n.endsWith("/")).map((n) => [n, () => unzipSync(bytes, { filter: (f) => f.name === n })[n]]));
}

const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("zip_same.mjs");
if (isMain) {
  const [pa, pb] = process.argv.slice(2);
  if (!pa || !pb) {
    console.error("usage: node scripts/check/zip_same.mjs <a.zip> <b.zip>");
    process.exit(2);
  }
  const res = compareFiles(zipEntries(pa), zipEntries(pb));
  for (const n of res.onlyA) console.log(`only in ${pa}: ${n}`);
  for (const n of res.onlyB) console.log(`only in ${pb}: ${n}`);
  for (const d of res.differ) console.log(`DIFFERS ${d.name}: ${d.why}`);
  if (!res.orderSame) console.log("entries are in a different order");
  const same = !res.onlyA.length && !res.onlyB.length && !res.differ.length;
  console.log(same ? `same: ${Object.keys(zipEntries(pa)).length} entries byte-identical${res.orderSame ? "" : " (order differs)"}` : "NOT the same");
  process.exit(same ? 0 : 1);
}
