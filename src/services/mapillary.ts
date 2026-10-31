// Mapillary map features: traffic signs, poles, street lights, traffic lights and painted road
// marks detected in street photos, read from Mapillary's z14 vector tiles over a box
// (docs/specs/mapillary.md). Everything that interprets them is in the core (furniture.ts,
// utilities.ts, track.ts). Also remembers the user's own token in the browser.
//
// Mapillary data is CC BY-SA: tracks containing it are never published.

import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { lngLatToPixel, pixelToLngLat, type LngLat } from "../core/geo";

const TOKEN_KEY = "mapillary_token";
const Z = 14;
/** More tiles than this (about 800 km² at Busselton) and nothing is fetched. */
export const MAX_SEEN_TILES = 200;

const TILE_SETS = [
  { url: "https://tiles.mapillary.com/maps/vtp/mly_map_feature_point/2", layer: "point" },
  { url: "https://tiles.mapillary.com/maps/vtp/mly_map_feature_traffic_sign/2", layer: "traffic_sign" },
] as const;

/** Only the kinds the build can place. */
const WANTED = /^(object--support--utility-pole|object--street-light|object--traffic-light|regulatory--|warning--|complementary--chevron|marking--discrete--(stop-line|crosswalk-zebra|give-way|arrow--|text--|symbol--bicycle))/;

type KeyStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function storage(given?: KeyStore): KeyStore | undefined {
  return given ?? (globalThis as { localStorage?: KeyStore }).localStorage;
}

/** The remembered token, or "" (none, or no storage). */
export function savedToken(store?: KeyStore): string {
  try {
    return storage(store)?.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

/** Remembers the token (an empty one forgets it). Storage errors are ignored. */
export function saveToken(token: string, store?: KeyStore): void {
  try {
    const s = storage(store);
    if (!s) return;
    if (token) s.setItem(TOKEN_KEY, token);
    else s.removeItem(TOKEN_KEY);
  } catch {
    // not remembered
  }
}

export interface SeenOptions {
  /** fetch-compatible function (tests). */
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  /** Requests at a time (6). */
  concurrency?: number;
  /** Per-request timeout, ms (20 000). */
  timeoutMs?: number;
  /** Retries after a network error or 5xx (2). */
  retries?: number;
  /** First retry delay, ms, doubling (1000). */
  retryDelayMs?: number;
  /** Told when the box is too big, for the build's missing-data report. */
  warn?: (message: string) => void;
}

type Answer = { ok: true; body: ArrayBuffer } | { ok: false; status?: number };

async function request(url: string, o: Required<Omit<SeenOptions, "warn">>): Promise<Answer> {
  let status: number | undefined;
  for (let attempt = 0; attempt <= o.retries; attempt++) {
    if (attempt) await new Promise((ok) => setTimeout(ok, o.retryDelayMs * 2 ** (attempt - 1)));
    try {
      const init = typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
        ? { signal: AbortSignal.timeout(o.timeoutMs) }
        : undefined;
      const r = await o.fetch(url, init);
      if (r.ok) return { ok: true, body: await r.arrayBuffer() };
      status = r.status;
      if (r.status < 500) return { ok: false, status };
    } catch {
      // network error: retry
    }
  }
  return { ok: false, status };
}

function features(body: ArrayBuffer, layerName: string, tx: number, ty: number): { at: LngLat; value: string }[] {
  const layer = new VectorTile(new PbfReader(new Uint8Array(body))).layers[layerName];
  if (!layer) return [];
  const out: { at: LngLat; value: string }[] = [];
  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i);
    const value = String(f.properties.value ?? "");
    if (!WANTED.test(value)) continue;
    const p = f.loadGeometry()[0]?.[0];
    if (!p) continue;
    const ext = f.extent;
    if (p.x < 0 || p.y < 0 || p.x >= ext || p.y >= ext) continue;
    out.push({ at: pixelToLngLat([(tx + p.x / ext) * 256, (ty + p.y / ext) * 256], Z), value });
  }
  return out;
}

/**
 * Every wanted detection in the box [west, south, east, north], in request order (tiles row by
 * row, points before signs), whatever order the answers came in.
 */
export async function fetchSeen(
  bbox: [number, number, number, number],
  token: string,
  opts: SeenOptions = {},
): Promise<{ at: LngLat; value: string }[]> {
  const [w, s, e, n] = bbox;
  const nw = lngLatToPixel([w, n], Z), se = lngLatToPixel([e, s], Z);
  const x0 = Math.floor(nw[0] / 256), x1 = Math.floor(se[0] / 256);
  const y0 = Math.floor(nw[1] / 256), y1 = Math.floor(se[1] / 256);
  const count = (x1 - x0 + 1) * (y1 - y0 + 1);
  if (count > MAX_SEEN_TILES) {
    const msg = `area too big for Mapillary: ${count} tiles (limit ${MAX_SEEN_TILES})`;
    opts.warn?.(msg);
    throw new Error(msg);
  }
  const o = {
    fetch: opts.fetch ?? ((url: string, init?: RequestInit) => fetch(url, init)),
    concurrency: opts.concurrency ?? 6,
    timeoutMs: opts.timeoutMs ?? 20_000,
    retries: opts.retries ?? 2,
    retryDelayMs: opts.retryDelayMs ?? 1000,
  };
  const slots: { url: string; layer: string; tx: number; ty: number }[] = [];
  const t = encodeURIComponent(token);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      for (const set of TILE_SETS) slots.push({ url: `${set.url}/${Z}/${tx}/${ty}?access_token=${t}`, layer: set.layer, tx, ty });
    }
  }
  const answers: Answer[] = new Array(slots.length);
  let next = 0;
  const worker = async () => {
    while (next < slots.length) {
      const i = next++;
      answers[i] = await request(slots[i].url, o);
    }
  };
  await Promise.all(Array.from({ length: Math.min(o.concurrency, slots.length) }, worker));

  const out: { at: LngLat; value: string }[] = [];
  let ok = 0, rejected = false;
  answers.forEach((a, i) => {
    if (!a.ok) {
      if (a.status === 401 || a.status === 403) rejected = true;
      return;
    }
    ok++;
    try {
      out.push(...features(a.body, slots[i].layer, slots[i].tx, slots[i].ty));
    } catch {
      // an unreadable tile contributes nothing
    }
  });
  if (slots.length && !ok) {
    throw new Error(rejected ? "Mapillary rejected the token" : "Mapillary didn't answer (offline or down)");
  }
  return out;
}
