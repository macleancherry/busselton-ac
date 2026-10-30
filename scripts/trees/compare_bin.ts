// Compares our tree .bin with Content Manager's conversion of the same model (make_reference.ts),
// to check the writer: tree.ini values, each LOD's counts and box, and the triangle winding.
//
//   npx tsx scripts/trees/compare_bin.ts <ours.bin> <cm.bin>
import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";

function read(path: string) {
  const files = unzipSync(new Uint8Array(readFileSync(path)));
  const ini = new TextDecoder().decode(files["tree.ini"] ?? new Uint8Array());
  const meshes = Object.keys(files).filter((f) => f.endsWith(".mesh")).map((name) => {
    const b = files[name], dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let o = 0;
    const i32 = () => { const v = dv.getInt32(o, true); o += 4; return v; };
    const version = i32(); o += 1;
    const nt = i32();
    const textures: string[] = [];
    for (let t = 0; t < nt; t++) { o += 4; const l = i32(); textures.push(new TextDecoder().decode(b.subarray(o, o + l))); o += l; }
    let tris = 0, verts = 0, agree = 0, disagree = 0, trunk: number | null = null;
    const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    while (o < b.length) {
      const a = i32();
      if (a === -1) { i32(); trunk = dv.getFloat32(o, true); o += 4; break; }
      i32();
      const ni = i32(), idx: number[] = [];
      for (let k = 0; k < ni; k++) { idx.push(dv.getUint16(o, true)); o += 2; }
      const nv = i32(), base = o;
      const P = (v: number, k: number) => dv.getFloat32(base + v * 44 + k * 4, true);
      for (let v = 0; v < nv; v++) for (let k = 0; k < 3; k++) { box[k] = Math.min(box[k], P(v, k)); box[k + 3] = Math.max(box[k + 3], P(v, k)); }
      // Winding against the vertex normals: does (b - a) x (c - a) point the same way as the normal?
      for (let t = 0; t < ni; t += 3) {
        const [ia, ib, ic] = [idx[t], idx[t + 1], idx[t + 2]];
        const e1 = [0, 1, 2].map((k) => P(ib, k) - P(ia, k)), e2 = [0, 1, 2].map((k) => P(ic, k) - P(ia, k));
        const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        const vn = [3, 4, 5].map((k) => P(ia, k));
        const d = n[0] * vn[0] + n[1] * vn[1] + n[2] * vn[2];
        if (d > 0) agree++; else if (d < 0) disagree++;
      }
      o = base + nv * 44;
      tris += ni / 3; verts += nv;
    }
    return { name, version, textures, tris, verts, box: box.map((x) => +x.toFixed(3)), winding: `${agree} with the normals, ${disagree} against`, trunk };
  });
  return { ini, meshes: meshes.sort((a, b) => b.tris - a.tris) };
}

const [a, b] = [read(process.argv[2]), read(process.argv[3])];
console.log("== tree.ini (ours) ==\n" + a.ini + "\n== tree.ini (CM) ==\n" + b.ini);
for (let i = 0; i < Math.max(a.meshes.length, b.meshes.length); i++) {
  console.log(`LOD ${i}\n  ours ${JSON.stringify(a.meshes[i])}\n  CM   ${JSON.stringify(b.meshes[i])}`);
}
