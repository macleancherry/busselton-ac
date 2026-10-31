// Placed scenery as simple pieces (docs/specs/furniture.md): placers in several modules return
// these, and furniture.ts `buildPieces` turns the whole list into meshes once the sign art atlas
// is drawn. Kept on its own so those modules don't import the furniture placers.
import { type Vec2 } from "./geo";

/** A post, beam, slab or canopy: `along` is the unit direction of its length; heights z0 (bottom) to z1 (top). */
export type BoxPiece = { kind: "box"; at: Vec2; along: Vec2; length: number; depth: number; z0: number; z1: number; material: string };

/** A street name blade printed on both faces; `along` is its long axis, `z` its centre height. */
export type BladePiece = { kind: "blade"; at: Vec2; along: Vec2; z: number; height: number; art: string };

/** A sign face looking along `normal`, bottom at z0, its width from the art's aspect. */
export type FacePiece = { kind: "face"; at: Vec2; normal: Vec2; z0: number; height: number; art: string; twoSided?: boolean };

export type Piece = BoxPiece | BladePiece | FacePiece;
