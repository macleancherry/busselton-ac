// Small stand-ins for the browser APIs the services use (fetch, createImageBitmap, OffscreenCanvas,
// ImageData), so their requests and drawing can be checked in Node.
//
// A "PNG" answer here is the raw 256 x 256 RGBA bytes with content type image/png: the fake
// createImageBitmap keeps them, and drawing that bitmap at full size copies them onto the canvas.
import { vi } from "vitest";

export interface Recorded { method: string; url: string; body: string }

export type Handler = (url: string, init: RequestInit | undefined) => Response | Promise<Response>;

export function bodyText(init: RequestInit | undefined): string {
  const b = init?.body;
  if (b == null) return "";
  if (typeof b === "string") return b;
  if (b instanceof URLSearchParams) return b.toString();
  return String(b);
}

/** Stub global fetch with a handler; every call is recorded (method, URL, body as sent). */
export function fakeFetch(handler: Handler): Recorded[] {
  const log: Recorded[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    log.push({ method: (init?.method ?? "GET").toUpperCase(), url, body: bodyText(init) });
    if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
    return handler(url, init);
  }));
  return log;
}

export const TILE_BYTES = 256 * 256 * 4;

/** A 256 x 256 RGBA tile filled with one colour. */
export function solidTile(r: number, g: number, b: number, a = 255): Uint8Array {
  const out = new Uint8Array(TILE_BYTES);
  for (let i = 0; i < out.length; i += 4) { out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = a; }
  return out;
}

/** The Terrarium colour of a height. */
export function terrariumRgb(h: number): [number, number, number] {
  const v = h + 32768;
  const r = Math.floor(v / 256), g = Math.floor(v - r * 256), b = Math.round((v - Math.floor(v)) * 256);
  return [r, g, Math.min(255, b)];
}

export function pngResponse(rgba: Uint8Array, status = 200): Response {
  return new Response(rgba.slice().buffer as ArrayBuffer, { status, headers: { "content-type": "image/png" } });
}

/** An image answer the fake bitmap remembers by name (for checking draw order). */
export function taggedImage(tag: string, type = "image/jpeg"): Response {
  return new Response("tag:" + tag, { status: 200, headers: { "content-type": type } });
}

export interface FakeBitmap { width: number; height: number; rgba: Uint8Array | null; close(): void; tag?: string }
export interface DrawCall { tag?: string; op: string; args: number[] }

class FakeImageData {
  constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {}
}

/** Fakes for createImageBitmap, OffscreenCanvas and ImageData. Returns every canvas made and their drawImage calls. */
export function fakeCanvas(): { canvases: FakeCanvas[]; draws: DrawCall[] } {
  const canvases: FakeCanvas[] = [];
  const draws: DrawCall[] = [];
  vi.stubGlobal("ImageData", FakeImageData);
  vi.stubGlobal("createImageBitmap", vi.fn(async (blob: Blob) => {
    const buf = new Uint8Array(await blob.arrayBuffer());
    if (buf.length === 3 && buf[0] === 0xde) throw new Error("bad image");
    const bmp: FakeBitmap = { width: 256, height: 256, rgba: buf.length === TILE_BYTES ? buf : null, close() {} };
    const text = buf.length < 4096 ? new TextDecoder().decode(buf) : "";
    if (text.startsWith("tag:")) bmp.tag = text.slice(4);
    return bmp;
  }));
  vi.stubGlobal("OffscreenCanvas", class extends FakeCanvas {
    constructor(w: number, h: number) { super(w, h, draws); canvases.push(this); }
  });
  return { canvases, draws };
}

export class FakeCanvas {
  pixels: Uint8ClampedArray;
  constructor(readonly width: number, readonly height: number, private draws: DrawCall[]) {
    this.pixels = new Uint8ClampedArray(width * height * 4);
  }
  getContext() {
    const canvas = this;
    const ctx = {
      globalCompositeOperation: "source-over",
      fillStyle: "#000000",
      imageSmoothingQuality: "low",
      imageSmoothingEnabled: true,
      drawImage(bmp: FakeBitmap, ...args: number[]) {
        canvas.draws.push({ tag: bmp.tag, op: ctx.globalCompositeOperation, args });
        if (!bmp.rgba) return;
        // Full-size draws at the origin copy the pixels (enough for the DEM readers).
        const [dx, dy, dw, dh] = args.length === 2 ? [args[0], args[1], 256, 256] : args.length === 4 ? args : args.slice(4);
        if (dx === 0 && dy === 0 && Math.round(dw) === canvas.width && Math.round(dh) === canvas.height && canvas.width === 256) {
          const behind = ctx.globalCompositeOperation === "destination-over";
          for (let i = 0; i < canvas.pixels.length; i += 4) {
            if (behind && canvas.pixels[i + 3] !== 0) continue;
            for (let k = 0; k < 4; k++) canvas.pixels[i + k] = bmp.rgba[i + k];
          }
        } else {
          // Elsewhere: mark the covered pixels opaque grey so "drawn" is visible.
          const x0 = Math.max(0, Math.floor(dx)), y0 = Math.max(0, Math.floor(dy));
          const x1 = Math.min(canvas.width, Math.ceil(dx + dw)), y1 = Math.min(canvas.height, Math.ceil(dy + dh));
          const behind = ctx.globalCompositeOperation === "destination-over";
          for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
            const i = (y * canvas.width + x) * 4;
            if (behind && canvas.pixels[i + 3] !== 0) continue;
            canvas.pixels[i] = canvas.pixels[i + 1] = canvas.pixels[i + 2] = 100; canvas.pixels[i + 3] = 255;
          }
        }
      },
      fillRect(x: number, y: number, w: number, h: number) {
        const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(ctx.fillStyle));
        const rgb = m ? [1, 2, 3].map((k) => parseInt(m[k], 16)) : [0, 0, 0];
        const behind = ctx.globalCompositeOperation === "destination-over";
        for (let yy = Math.max(0, y); yy < Math.min(canvas.height, y + h); yy++) for (let xx = Math.max(0, x); xx < Math.min(canvas.width, x + w); xx++) {
          const i = (yy * canvas.width + xx) * 4;
          if (behind && canvas.pixels[i + 3] !== 0) continue;
          canvas.pixels[i] = rgb[0]; canvas.pixels[i + 1] = rgb[1]; canvas.pixels[i + 2] = rgb[2]; canvas.pixels[i + 3] = 255;
        }
      },
      clearRect() { canvas.pixels.fill(0); },
      getImageData(_x: number, _y: number, w: number, h: number) {
        return new FakeImageData(new Uint8ClampedArray(canvas.pixels.slice(0, w * h * 4)), w, h);
      },
      putImageData(img: { data: Uint8ClampedArray }) { canvas.pixels.set(img.data.subarray(0, canvas.pixels.length)); },
    };
    return ctx;
  }
  transferToImageBitmap() { return { width: this.width, height: this.height, close() {} }; }
}
