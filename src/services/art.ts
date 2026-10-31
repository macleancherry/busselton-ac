// Draws every requested piece of sign art into one atlas (signart.png) in the build worker, and
// says where each piece landed (docs/specs/art.md). The layout is pure (layoutArt, tested in
// Node with a fake text measurer); drawing needs OffscreenCanvas.
//
// Text is measured and drawn with the system's sign font stack, so blade widths can differ
// between machines without Arial Narrow / Arial. A bundled open-licence font is a later item.

import type { ArtAtlas, ArtCell, ArtRequest } from "../core/art";
import { encodePng } from "../core/png";

/** Width of `text` in pixels when drawn in the CSS `font`. */
export type MeasureText = (text: string, font: string) => number;

export const ATLAS_WIDTH = 2048;
const PAD = 4;
const GAP = 6;
const MAX_HEIGHT = 8192;
const FONT_STACK = `"Arial Narrow", "Helvetica Neue", Arial, sans-serif`;

const bold = (px: number) => `bold ${px}px ${FONT_STACK}`;
const italicBold = (px: number) => `italic bold ${px}px ${FONT_STACK}`;

/** Fixed box sizes (w, h) by kind; street is sized by its text. */
const SIZES: Record<Exclude<ArtRequest["kind"], "street">, [number, number]> = {
  poi: [384, 160],
  tourist: [384, 160],
  speed: [160, 192],
  stop: [160, 160],
  giveway: [160, 140],
  warning: [160, 160],
  chevron: [128, 160],
  noentry: [160, 160],
  keepleft: [128, 160],
  bus: [128, 160],
  info: [160, 160],
  gate: [480, 150],
  banner: [768, 128],
  feather: [128, 448],
  lights: [320, 128],
  flag: [160, 112],
  back: [32, 32],
};

/** A request's box in pixels. */
export function boxSize(item: ArtRequest, measure: MeasureText): [number, number] {
  if (item.kind === "street") {
    const textW = measure((item.text ?? "").toUpperCase(), bold(44));
    const w = Math.min(Math.max(Math.ceil(textW) + 48, 220), ATLAS_WIDTH - 2 * PAD);
    return [w, 64];
  }
  return SIZES[item.kind] ?? SIZES.back;
}

export interface PlacedArt { key: string; item: ArtRequest; x: number; y: number; w: number; h: number; /** Index in the request list. */ index: number }

export interface ArtLayout {
  width: number;
  height: number;
  placed: PlacedArt[];
  cells: Record<string, ArtCell>;
}

/** Shelf-packs the boxes, tallest first (stable), and works out each piece's cell. */
export function layoutArt(items: ArtRequest[], measure: MeasureText): ArtLayout {
  const W = ATLAS_WIDTH;
  const boxes = items.map((item, i) => {
    const [w, h] = boxSize(item, measure);
    return { item, w, h, i };
  });
  boxes.sort((a, b) => b.h - a.h || a.i - b.i);
  let x = PAD, y = PAD, row = 0;
  const placed: PlacedArt[] = [];
  for (const b of boxes) {
    if (x + b.w + PAD > W && x > PAD) {
      x = PAD;
      y += row + GAP;
      row = 0;
    }
    placed.push({ key: b.item.key, item: b.item, x, y, w: b.w, h: b.h, index: b.i });
    x += b.w + GAP;
    row = Math.max(row, b.h);
  }
  let H = 64;
  while (H < y + row + PAD) H *= 2;
  if (H > MAX_HEIGHT) {
    throw new Error(`Sign art atlas too tall (${W} x ${H}) for ${items.length} pieces of art`);
  }
  // In request order, so a key requested twice gets the later request's cell.
  const cells: Record<string, ArtCell> = {};
  for (const p of [...placed].sort((a, b) => a.index - b.index)) {
    cells[p.key] = {
      u0: (p.x + 0.5) / W,
      u1: (p.x + p.w - 0.5) / W,
      v0: (p.y + 0.5) / H,
      v1: (p.y + p.h - 0.5) / H,
      aspect: p.w / p.h,
    };
  }
  return { width: W, height: H, placed, cells };
}

/** Splits a long poi/tourist name in two at the space nearest the middle (first on a tie). */
export function splitLines(text: string): string[] {
  if (text.length <= 16 || !text.includes(" ")) return [text];
  const mid = text.length / 2;
  let best = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== " ") continue;
    if (best < 0 || Math.abs(i - mid) < Math.abs(best - mid)) best = i;
  }
  return [text.slice(0, best), text.slice(best + 1)];
}

/** The fit rule: from `base`, down 2 px at a time while too wide and above 10 px. */
export function fitSize(measure: MeasureText, text: string, font: (px: number) => string, base: number, maxW: number): number {
  let size = base;
  while (measure(text, font(size)) > maxW && size > 10) size -= 2;
  return size;
}

// ---- drawing (browser worker only) ----

type Ctx = OffscreenCanvasRenderingContext2D;

const ctxMeasure = (ctx: Ctx): MeasureText => (text, font) => {
  ctx.font = font;
  return ctx.measureText(text).width;
};

/** Centred text at `size`, squeezed horizontally if still wider than maxW (at the size floor). */
function centredText(ctx: Ctx, text: string, cx: number, cy: number, font: string, maxW: number): void {
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const width = ctx.measureText(text).width;
  if (width > maxW && width > 0) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(maxW / width, 1);
    ctx.fillText(text, 0, 0);
    ctx.restore();
  } else {
    ctx.fillText(text, cx, cy);
  }
}

function fittedText(ctx: Ctx, text: string, cx: number, cy: number, font: (px: number) => string, base: number, maxW: number): void {
  const size = fitSize(ctxMeasure(ctx), text, font, base, maxW);
  centredText(ctx, text, cx, cy, font(size), maxW);
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function polygon(ctx: Ctx, pts: [number, number][]): void {
  ctx.beginPath();
  pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
  ctx.closePath();
}

/** A triangle shrunk towards its incentre so every edge moves in by `d`. */
function insetTriangle(t: [number, number][], d: number): [number, number][] {
  const [A, B, C] = t;
  const len = (p: [number, number], q: [number, number]) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  const a = len(B, C), b = len(A, C), c = len(A, B), s = (a + b + c) / 2;
  const area = Math.abs((B[0] - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (B[1] - A[1])) / 2;
  const r = area / s;
  const I: [number, number] = [(a * A[0] + b * B[0] + c * C[0]) / (2 * s), (a * A[1] + b * B[1] + c * C[1]) / (2 * s)];
  const k = (r - d) / r;
  return t.map(([px, py]) => [I[0] + (px - I[0]) * k, I[1] + (py - I[1]) * k]);
}

/** A thick arrow from (x0, y0) to its tip (x1, y1). */
function arrow(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, width: number, head: number): void {
  const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy);
  const ux = dx / l, uy = dy / l, bx = x1 - ux * head, by = y1 - uy * head;
  ctx.lineWidth = width;
  ctx.lineCap = "butt";
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(bx + ux * 2, by + uy * 2);
  ctx.stroke();
  polygon(ctx, [[x1, y1], [bx - uy * head * 0.75, by + ux * head * 0.75], [bx + uy * head * 0.75, by - ux * head * 0.75]]);
  ctx.fill();
}

function twoLinePanel(ctx: Ctx, w: number, h: number, panel: string, text: string): void {
  roundRect(ctx, 0, 0, w, h, 14);
  ctx.fillStyle = panel;
  ctx.fill();
  roundRect(ctx, 8, 8, w - 16, h - 16, 10);
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 5;
  ctx.stroke();
  const lines = splitLines(text);
  const measure = ctxMeasure(ctx);
  const base = lines.length > 1 ? 52 : 64;
  const maxW = w - 48;
  const size = Math.min(...lines.map((l) => fitSize(measure, l, bold, base, maxW)));
  ctx.fillStyle = "#fff";
  lines.forEach((line, i) => {
    centredText(ctx, line, w / 2, h / 2 + (i - (lines.length - 1) / 2) * size * 1.05, bold(size), maxW);
  });
}

function warningSymbol(ctx: Ctx, text: string, cx: number, cy: number): void {
  ctx.fillStyle = "#111";
  ctx.strokeStyle = "#111";
  ctx.lineWidth = 12;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const curve = (mirror: boolean) => {
    ctx.save();
    if (mirror) {
      ctx.translate(2 * cx, 0);
      ctx.scale(-1, 1);
    }
    ctx.beginPath();
    ctx.moveTo(cx + 12, cy + 42);
    ctx.lineTo(cx + 12, cy - 2);
    ctx.quadraticCurveTo(cx + 12, cy - 24, cx - 12, cy - 30);
    ctx.stroke();
    polygon(ctx, [[cx - 30, cy - 33], [cx - 12, cy - 46], [cx - 10, cy - 16]]);
    ctx.fill();
    ctx.restore();
  };
  if (/curve-left|turn-left|winding/.test(text)) curve(false);
  else if (/curve-right|turn-right/.test(text)) curve(true);
  else if (/crossroads|intersection/.test(text)) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - 40);
    ctx.lineTo(cx, cy + 40);
    ctx.moveTo(cx - 40, cy);
    ctx.lineTo(cx + 40, cy);
    ctx.stroke();
  } else if (/roundabout/.test(text)) {
    ctx.beginPath();
    ctx.arc(cx, cy, 24, -Math.PI * 0.35, Math.PI * 1.5);
    ctx.stroke();
    polygon(ctx, [[cx + 4, cy - 36], [cx + 22, cy - 24], [cx + 2, cy - 12]]);
    ctx.fill();
  } else if (/traffic-signals/.test(text)) {
    ctx.lineWidth = 4;
    ctx.strokeRect(cx - 16, cy - 42, 32, 84);
    (["#d0201a", "#f6a700", "#1b8a3a"] as const).forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(cx, cy - 26 + i * 26, 9, 0, Math.PI * 2);
      ctx.fill();
    });
  } else if (/kangaroo/.test(text)) {
    // Hopping right (W5-29): tail behind, body leaning forward, head up on the right.
    ctx.beginPath();
    ctx.ellipse(cx - 2, cy + 4, 24, 15, -0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx + 26, cy - 26, 10, 7, -0.25, 0, Math.PI * 2);
    ctx.fill();
    polygon(ctx, [[cx + 20, cy - 31], [cx + 18, cy - 46], [cx + 26, cy - 33]]);
    ctx.fill();
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(cx + 12, cy - 6);
    ctx.lineTo(cx + 22, cy - 22);
    ctx.stroke();
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(cx - 20, cy + 14);
    ctx.quadraticCurveTo(cx - 36, cy + 26, cx - 50, cy + 40);
    ctx.stroke();
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(cx - 8, cy + 14);
    ctx.lineTo(cx + 2, cy + 32);
    ctx.lineTo(cx + 24, cy + 36);
    ctx.stroke();
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(cx + 14, cy - 2);
    ctx.lineTo(cx + 26, cy + 6);
    ctx.stroke();
  } else if (/pedestrian/.test(text)) {
    ctx.beginPath();
    ctx.arc(cx + 2, cy - 34, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx, cy - 20);
    ctx.lineTo(cx - 4, cy + 8);
    ctx.moveTo(cx - 4, cy + 8);
    ctx.lineTo(cx - 18, cy + 40);
    ctx.moveTo(cx - 4, cy + 8);
    ctx.lineTo(cx + 14, cy + 40);
    ctx.moveTo(cx, cy - 14);
    ctx.lineTo(cx - 16, cy + 2);
    ctx.moveTo(cx, cy - 14);
    ctx.lineTo(cx + 16, cy);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(cx, cy - 38);
    ctx.lineTo(cx, cy + 10);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy + 30, 8, 0, Math.PI * 2);
    ctx.fill();
  }
}

function chequer(ctx: Ctx, x: number, y: number, cols: number, rows: number, sw: number, sh: number): void {
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      ctx.fillStyle = (r + c) % 2 ? "#f4f4f4" : "#111";
      ctx.fillRect(x + c * sw, y + r * sh, sw, sh);
    }
  }
}

/** Draws one piece in its own box, with (0, 0) at the box's top left. */
function drawPiece(ctx: Ctx, item: ArtRequest, w: number, h: number): void {
  const cx = w / 2, cy = h / 2;
  const text = item.text ?? "";
  switch (item.kind) {
    case "street": {
      ctx.fillStyle = "#1c3f94";
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 4;
      ctx.strokeRect(5, 5, w - 10, h - 10);
      ctx.fillStyle = "#fff";
      fittedText(ctx, text.toUpperCase(), cx, cy + 2, bold, 44, w - 40);
      break;
    }
    case "poi":
      twoLinePanel(ctx, w, h, item.colour || "#2d3a4a", text);
      break;
    case "tourist":
      twoLinePanel(ctx, w, h, "#6b3d1f", text);
      break;
    case "speed": {
      roundRect(ctx, 2, 2, w - 4, h - 4, 12);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.strokeStyle = "#222";
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.strokeStyle = "#d0201a";
      ctx.lineWidth = 16;
      ctx.beginPath();
      ctx.arc(cx, cy, 66, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#111";
      fittedText(ctx, text, cx, cy + 4, bold, 68, 96);
      break;
    }
    case "stop": {
      const pts: [number, number][] = [];
      for (let k = 0; k < 8; k++) {
        const a = Math.PI / 8 + (k * Math.PI) / 4;
        pts.push([cx + 78 * Math.cos(a), cy + 78 * Math.sin(a)]);
      }
      polygon(ctx, pts);
      ctx.fillStyle = "#c8102e";
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 6;
      ctx.lineJoin = "round";
      polygon(ctx, pts.map(([px, py]) => [cx + (px - cx) * 0.94, cy + (py - cy) * 0.94]));
      ctx.stroke();
      ctx.fillStyle = "#fff";
      centredText(ctx, "STOP", cx, cy, bold(50), w - 30);
      break;
    }
    case "giveway": {
      const outer: [number, number][] = [[4, 4], [w - 4, 4], [cx, h - 4]];
      polygon(ctx, outer);
      ctx.fillStyle = "#c8102e";
      ctx.fill();
      polygon(ctx, insetTriangle(outer, 16));
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.fillStyle = "#111";
      centredText(ctx, "GIVE", cx, h * 0.26, bold(20), w - 70);
      centredText(ctx, "WAY", cx, h * 0.26 + 22, bold(20), w - 90);
      break;
    }
    case "warning": {
      const diamond: [number, number][] = [[cx, 2], [w - 2, cy], [cx, h - 2], [2, cy]];
      polygon(ctx, diamond);
      ctx.fillStyle = "#f6c700";
      ctx.fill();
      ctx.strokeStyle = "#111";
      ctx.lineWidth = 6;
      ctx.lineJoin = "round";
      polygon(ctx, [[cx, 7], [w - 7, cy], [cx, h - 7], [7, cy]]);
      ctx.stroke();
      warningSymbol(ctx, text, cx, cy);
      break;
    }
    case "chevron": {
      ctx.fillStyle = "#f6c700";
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "#111";
      ctx.lineWidth = 26;
      ctx.lineJoin = "miter";
      ctx.lineCap = "butt";
      const s = text === "left" ? 1 : -1;
      ctx.beginPath();
      ctx.moveTo(cx + s * 22, cy - 48);
      ctx.lineTo(cx - s * 22, cy);
      ctx.lineTo(cx + s * 22, cy + 48);
      ctx.stroke();
      break;
    }
    case "noentry": {
      ctx.fillStyle = "#c8102e";
      ctx.beginPath();
      ctx.arc(cx, cy, 76, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.fillRect(cx - 52, cy - 12, 104, 24);
      break;
    }
    case "keepleft": {
      roundRect(ctx, 2, 2, w - 4, h - 4, 10);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.strokeStyle = "#111";
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.strokeStyle = "#111";
      ctx.fillStyle = "#111";
      arrow(ctx, cx + 30, cy - 40, cx - 34, cy + 40, 14, 30);
      break;
    }
    case "bus": {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#1c3f94";
      ctx.fillRect(6, 6, w - 12, h - 12);
      ctx.fillStyle = "#fff";
      centredText(ctx, "BUS", cx, h * 0.4, bold(40), w - 24);
      centredText(ctx, "STOP", cx, h * 0.66, bold(30), w - 24);
      break;
    }
    case "info": {
      roundRect(ctx, 0, 0, w, h, 12);
      ctx.fillStyle = "#1c3f94";
      ctx.fill();
      ctx.fillStyle = "#fff";
      fittedText(ctx, text || "i", cx, cy, bold, 60, 140);
      break;
    }
    case "gate": {
      const finish = text === "FINISH";
      ctx.fillStyle = finish ? "#111" : "#1d7a3a";
      ctx.fillRect(0, 0, w, h);
      if (finish) {
        const cols = Math.ceil(w / 20);
        chequer(ctx, 0, 0, cols, 2, 20, 20);
        chequer(ctx, 0, h - 40, cols, 2, 20, 20);
      }
      ctx.strokeStyle = "#f4f4f4";
      ctx.lineWidth = 6;
      ctx.strokeRect(6, 6, w - 12, h - 12);
      ctx.fillStyle = "#f4f4f4";
      fittedText(ctx, text, cx, cy, bold, finish ? 60 : 90, 420);
      break;
    }
    case "banner": {
      const ink = item.ink || "#fff";
      ctx.fillStyle = item.colour || "#c8102e";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = ink;
      ctx.fillRect(0, 10, w, 4);
      ctx.fillRect(0, h - 14, w, 4);
      fittedText(ctx, text.toUpperCase(), cx, cy, italicBold, 88, w - 60);
      break;
    }
    case "feather": {
      ctx.beginPath();
      ctx.moveTo(4, h - 4);
      ctx.lineTo(4, 44);
      ctx.quadraticCurveTo(4, 4, 48, 6);
      ctx.quadraticCurveTo(w - 4, 14, w - 4, 70);
      ctx.quadraticCurveTo(w - 10, h * 0.6, w * 0.4, h - 4);
      ctx.closePath();
      ctx.fillStyle = item.colour || "#c8102e";
      ctx.fill();
      ctx.save();
      ctx.translate(w * 0.42, h / 2 + 10);
      ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = item.ink || "#fff";
      fittedText(ctx, text.toUpperCase(), 0, 0, italicBold, 56, h - 120);
      ctx.restore();
      break;
    }
    case "lights": {
      roundRect(ctx, 0, 0, w, h, 10);
      ctx.fillStyle = "#111";
      ctx.fill();
      for (let row = 0; row < 2; row++) {
        ctx.fillStyle = row ? "#3a0d0b" : "#e0261b";
        for (let i = 0; i < 5; i++) {
          ctx.beginPath();
          ctx.arc(cx + (i - 2) * 60, cy + (row ? 30 : -30), 22, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }
    case "flag": {
      if (text === "chequered") {
        chequer(ctx, 0, 0, 8, 6, w / 8, h / 6);
      } else if (text === "blue") {
        ctx.fillStyle = "#1f4fbf";
        ctx.fillRect(0, 0, w, h);
        polygon(ctx, [[0, h - 22], [w - 30, 0], [w, 0], [w, 22], [30, h], [0, h]]);
        ctx.fillStyle = "#f4d000";
        ctx.fill();
      } else {
        ctx.fillStyle = text === "green" ? "#1f9a3a" : "#f4d000";
        ctx.fillRect(0, 0, w, h);
      }
      break;
    }
    case "back":
    default: {
      ctx.fillStyle = "#9a9ea3";
      ctx.fillRect(0, 0, w, h);
    }
  }
}

/** Draws every piece into one atlas and returns the PNG and each piece's cell. */
export async function renderArt(items: ArtRequest[]): Promise<ArtAtlas> {
  const scratch = new OffscreenCanvas(8, 8).getContext("2d")!;
  const layout = layoutArt(items, ctxMeasure(scratch));
  const canvas = new OffscreenCanvas(layout.width, layout.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  for (const p of layout.placed) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.beginPath();
    ctx.rect(0, 0, p.w, p.h);
    ctx.clip();
    drawPiece(ctx, p.item, p.w, p.h);
    ctx.restore();
  }
  const rgba = ctx.getImageData(0, 0, layout.width, layout.height).data;
  return { data: encodePng(rgba, layout.width, layout.height), cells: layout.cells };
}
