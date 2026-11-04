// The local-cars set (docs/plans/local-cars.md): every body, its defaults (from published overall
// dimensions only), its named variants and its builder. Phase 2 picks from here per parked bay.

import { buildHatch, HATCH_DEFAULTS, HATCH_VARIANTS, hatchDimensions } from "./hatch";
import { buildPassengerUte, PASSENGER_UTE_DEFAULTS, PASSENGER_UTE_VARIANTS, passengerUteDimensions } from "./passengerUte";
import { buildSedan, SEDAN_DEFAULTS, SEDAN_VARIANTS, sedanDimensions } from "./sedan";
import { buildStationWagon, STATION_WAGON_DEFAULTS, STATION_WAGON_VARIANTS, stationWagonDimensions } from "./stationWagon";
import {
  buildSuv, buildSuvSmall, SUV_DEFAULTS, SUV_SMALL_DEFAULTS, SUV_SMALL_VARIANTS, SUV_VARIANTS, suvDimensions, suvSmallDimensions,
} from "./suv";
import { buildTrayUte, TRAY_UTE_DEFAULTS, TRAY_UTE_VARIANTS, trayUteDimensions } from "./trayUte";
import { buildUte, UTE_DEFAULTS, UTE_VARIANTS, uteDimensions } from "./ute";
import { buildVan, VAN_DEFAULTS, VAN_VARIANTS, vanDimensions } from "./van";
import type { BaseSpec, Dimensions, VehicleMesh } from "./vehicle";
import { buildWagon4wd, WAGON4WD_DEFAULTS, WAGON4WD_VARIANTS, wagon4wdDimensions } from "./wagon4wd";

export interface BodyDef<S extends BaseSpec = BaseSpec> {
  /** Short id, also the export's file prefix. */
  id: string;
  /** What it stands for (reference only, never copied). */
  label: string;
  defaults: S;
  /** Named variants: "plain" (no extras but plates) first, "full" (every extra that goes together) last. */
  variants: Record<string, Partial<S>>;
  build(spec?: Partial<S>, lod?: 0 | 1): VehicleMesh;
  dimensions(spec?: Partial<S>): Dimensions;
}

function def<S extends BaseSpec>(d: BodyDef<S>): BodyDef {
  return d as unknown as BodyDef;
}

/** In the plan's table order. */
export const BODIES: BodyDef[] = [
  def({ id: "ute", label: "dual-cab 4x4 ute", defaults: UTE_DEFAULTS, variants: UTE_VARIANTS, build: buildUte, dimensions: uteDimensions }),
  def({ id: "trayute", label: "single or extra cab, alloy tray", defaults: TRAY_UTE_DEFAULTS, variants: TRAY_UTE_VARIANTS, build: buildTrayUte, dimensions: trayUteDimensions }),
  def({ id: "wagon4wd", label: "large 4WD wagon", defaults: WAGON4WD_DEFAULTS, variants: WAGON4WD_VARIANTS, build: buildWagon4wd, dimensions: wagon4wdDimensions }),
  def({ id: "suv", label: "medium SUV", defaults: SUV_DEFAULTS, variants: SUV_VARIANTS, build: buildSuv, dimensions: suvDimensions }),
  def({ id: "suvsmall", label: "small SUV", defaults: SUV_SMALL_DEFAULTS, variants: SUV_SMALL_VARIANTS, build: buildSuvSmall, dimensions: suvSmallDimensions }),
  def({ id: "hatch", label: "small hatch", defaults: HATCH_DEFAULTS, variants: HATCH_VARIANTS, build: buildHatch, dimensions: hatchDimensions }),
  def({ id: "sedan", label: "sedan", defaults: SEDAN_DEFAULTS, variants: SEDAN_VARIANTS, build: buildSedan, dimensions: sedanDimensions }),
  def({ id: "passute", label: "passenger ute", defaults: PASSENGER_UTE_DEFAULTS, variants: PASSENGER_UTE_VARIANTS, build: buildPassengerUte, dimensions: passengerUteDimensions }),
  def({ id: "van", label: "van", defaults: VAN_DEFAULTS, variants: VAN_VARIANTS, build: buildVan, dimensions: vanDimensions }),
  def({ id: "stationwagon", label: "station wagon", defaults: STATION_WAGON_DEFAULTS, variants: STATION_WAGON_VARIANTS, build: buildStationWagon, dimensions: stationWagonDimensions }),
];

export function body(id: string): BodyDef {
  const b = BODIES.find((x) => x.id === id);
  if (!b) throw new Error(`no body ${id}`);
  return b;
}
