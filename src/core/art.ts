// Sign artwork: what the build needs drawn into the sign atlas (signart.png), collected by key.
// The core never draws (no fonts, no DOM); src/services/art.ts renders the list in the browser
// worker and hands back the atlas (docs/specs/art.md).

export type ArtKind =
  | "street" | "poi" | "tourist" | "speed" | "stop" | "giveway" | "warning" | "chevron"
  | "noentry" | "keepleft" | "bus" | "info" | "back" | "gate" | "banner" | "feather" | "lights" | "flag";

/** One piece of art. `key` is its identity: geometry refers to art by key. */
export interface ArtRequest {
  key: string;
  kind: ArtKind;
  /** What it shows, or a hint for the kind (e.g. "left", "kangaroo", "chequered"). */
  text?: string;
  /** CSS colour: the panel of a poi, the background of a banner or feather. */
  colour?: string;
  /** CSS colour of sponsor lettering (banner, feather). */
  ink?: string;
}

/** Where a piece landed in the atlas: UVs with v = 0 at the top, and width / height in pixels. */
export interface ArtCell { u0: number; v0: number; u1: number; v1: number; aspect: number }

/** The atlas as a PNG with alpha, and each piece's cell by key. */
export interface ArtAtlas { data: Uint8Array; cells: Record<string, ArtCell> }

export type ArtRenderer = (items: ArtRequest[]) => Promise<ArtAtlas>;

/** Requests deduplicated by key: the first one added for a key is kept. */
export class ArtList {
  private readonly held = new Map<string, ArtRequest>();

  add(r: ArtRequest): string {
    if (!this.held.has(r.key)) this.held.set(r.key, r);
    return r.key;
  }

  /** The held requests in the order first added (a fresh array each time). */
  get list(): ArtRequest[] {
    return [...this.held.values()];
  }
}

export const streetKey = (name: string): string => `street:${name}`;
