// A tiny Mapbox Vector Tile writer for tests: hand-built tiles served by a stubbed fetch.
// Polygon rings are given open (no closing point); the reader closes them again.
import { PbfWriter } from "pbf";

export type MvtValue = string | number | boolean;
export interface MvtFeature { type: 1 | 2 | 3; props?: Record<string, MvtValue>; geom: { x: number; y: number }[][] }
export interface MvtLayer { name: string; extent?: number; features: MvtFeature[] }

const zigzag = (n: number) => (n << 1) ^ (n >> 31);

function geometry(f: MvtFeature): number[] {
  const out: number[] = [];
  let cx = 0, cy = 0;
  const point = (p: { x: number; y: number }) => {
    out.push(zigzag(p.x - cx), zigzag(p.y - cy));
    cx = p.x; cy = p.y;
  };
  for (const part of f.geom) {
    if (f.type === 1) {
      out.push(1 | (part.length << 3));
      part.forEach(point);
      continue;
    }
    out.push(1 | (1 << 3));
    point(part[0]);
    out.push(2 | ((part.length - 1) << 3));
    part.slice(1).forEach(point);
    if (f.type === 3) out.push(7 | (1 << 3));
  }
  return out;
}

export function encodeMvt(layers: MvtLayer[]): Uint8Array {
  const pbf = new PbfWriter();
  for (const layer of layers) {
    pbf.writeMessage(3, (l: MvtLayer, p: PbfWriter) => {
      const keys: string[] = [];
      const values: MvtValue[] = [];
      const keyIndex = (k: string) => { let i = keys.indexOf(k); if (i < 0) { i = keys.length; keys.push(k); } return i; };
      const valueIndex = (v: MvtValue) => { let i = values.findIndex((w) => w === v && typeof w === typeof v); if (i < 0) { i = values.length; values.push(v); } return i; };
      const feats = l.features.map((f) => {
        const tags: number[] = [];
        for (const [k, v] of Object.entries(f.props ?? {})) tags.push(keyIndex(k), valueIndex(v));
        return { f, tags };
      });
      p.writeVarintField(15, 2);
      p.writeStringField(1, l.name);
      for (const { f, tags } of feats) {
        p.writeMessage(2, (_: unknown, q: PbfWriter) => {
          q.writePackedVarint(2, tags);
          q.writeVarintField(3, f.type);
          q.writePackedVarint(4, geometry(f));
        }, null);
      }
      for (const k of keys) p.writeStringField(3, k);
      for (const v of values) {
        p.writeMessage(4, (_: unknown, q: PbfWriter) => {
          if (typeof v === "string") q.writeStringField(1, v);
          else if (typeof v === "boolean") q.writeBooleanField(7, v);
          else if (Number.isInteger(v)) q.writeSVarintField(6, v);
          else q.writeDoubleField(3, v);
        }, null);
      }
      p.writeVarintField(5, l.extent ?? 4096);
    }, layer);
  }
  return pbf.finish();
}
