// The headless build page: no map and no controls, just window.__app for
// scripts/headless/build-track.mjs to drive (docs/specs/headless-page.md). Routing and the build
// run here, in the page, so every download goes through the script's request cache and snapshots.

import type { LngLat } from "../core/geo";
import type { Vec3 } from "../core/mesh";
import type { BuildOptions } from "../core/options";
import type { TrackResult } from "../core/track";
import { zipTrack } from "../core/zip";
import { reverseGeocode, route as osrmRoute, routeWays, type Route } from "../services/osm";
import { runBuild, type BuildJob, type BuildOutcome } from "../services/pipeline";
import { headlessOptions, routeSummary, type RouteSummary } from "./headlessOptions";
import { createPreview, type PreviewScene } from "./preview";
import { ReplyState, stageText, type WorkerMessage } from "./workerProtocol";

export interface RouteInput {
  pins: LngLat[];
  loop: boolean;
  ways?: { ids: number[]; reverse: boolean };
}

export interface BuildInput {
  name: string;
  options: Record<string, unknown>;
  build?: Partial<BuildOptions>;
  token: string;
  houseLooks?: BuildJob["houseLooks"];
  landmarks?: { name: string; at: [number, number] }[];
}

export interface HeadlessApp {
  route(input: RouteInput): Promise<RouteSummary>;
  build(input: BuildInput): Promise<void>;
  progress(): string;
  result(): TrackResult | null;
  preview(): PreviewScene | null;
  dataWarnings(): string[];
  zip(): Uint8Array | null;
  shot(eye: Vec3, target: Vec3): string;
}

declare global {
  interface Window { __app: HeadlessApp }
}

const canvas = document.getElementById("preview-canvas") as HTMLCanvasElement;

let current: { route: Route; summary: RouteSummary; placeMeta: BuildJob["placeMeta"] } | null = null;
let progressText = "";
let lastResult: TrackResult | null = null;
let lastPreview: PreviewScene | null = null;
let lastWarnings: string[] = [];
let lastZip: Uint8Array | null = null;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function routePins(input: RouteInput): Promise<RouteSummary> {
  if (input.pins.length < 2) throw new Error("a route needs at least two pins");
  const through = input.loop ? [...input.pins, input.pins[0]] : input.pins;
  let r: Route;
  try {
    r = input.ways
      ? await routeWays(input.ways.ids, through, { reverse: input.ways.reverse, loop: input.loop })
      : await osrmRoute(through);
  } catch (e) {
    current = null;
    return { distance: 0, kind: input.loop ? "Circuit" : "A to B", lengthText: "", error: `Couldn't route between those pins: ${message(e)}`, note: "" };
  }
  const summary = routeSummary(r, input.loop);
  // The place name for ui_track.json, awaited so the build always has this route's.
  let placeMeta: BuildJob["placeMeta"] = {};
  try {
    const place = await reverseGeocode(r.coords[Math.floor(r.coords.length / 2)]);
    placeMeta = { country: place.country, city: place.town };
  } catch {
    // no place name
  }
  current = { route: r, summary, placeMeta };
  return summary;
}

/** Runs the job in the build worker; resolves undefined when the worker can't, so the page builds it. */
function buildInWorker(job: BuildJob): Promise<BuildOutcome | undefined> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./buildWorker.ts", import.meta.url), { type: "module" });
    } catch {
      resolve(undefined);
      return;
    }
    const state = new ReplyState();
    const act = (a: ReturnType<ReplyState["message"]>) => {
      if (a.kind === "progress") {
        progressText = a.text;
        return;
      }
      worker.terminate();
      if (a.kind === "onPage") resolve(undefined);
      else if (a.kind === "reject") reject(new Error(a.message));
      else {
        const chunkImages = new Map<string, OffscreenCanvas>();
        for (const [key, bmp] of a.images) {
          const c = new OffscreenCanvas(bmp.width, bmp.height);
          c.getContext("2d")!.drawImage(bmp, 0, 0);
          bmp.close();
          chunkImages.set(key, c);
        }
        resolve({ ...a.outcome, chunkImages });
      }
    };
    worker.onmessage = (e: MessageEvent<WorkerMessage>) => act(state.message(e.data));
    worker.onerror = (e: ErrorEvent) => {
      e.preventDefault();
      act(state.error(e.message));
    };
    worker.postMessage(job);
  });
}

async function buildOnPage(job: BuildJob): Promise<BuildOutcome> {
  return runBuild(
    job,
    async (stage, fraction = 0) => {
      progressText = stageText(stage, fraction);
      // Let the page answer the script's polls between stages.
      await new Promise((ok) => setTimeout(ok, 0));
    },
    (text) => { progressText = text; },
  );
}

async function build(input: BuildInput): Promise<void> {
  if (!current) throw new Error("No route to build: route the pins first");
  if (current.summary.error) throw new Error(current.summary.error);
  lastPreview?.dispose();
  lastPreview = null;
  lastResult = null;
  lastZip = null;
  lastWarnings = [];
  progressText = "";

  // A circuit on OSM highway=raceway ways is painted as a circuit (edge lines only), unless the route says otherwise.
  const opts: Partial<BuildOptions> = { ...headlessOptions(input.name, input.options), ...(current.route.raceway ? { raceway: true } : {}), ...(input.build ?? {}) };
  const job: BuildJob = {
    coords: current.route.coords,
    roundabouts: current.route.roundabouts,
    opts,
    token: input.token.trim(),
    imagerySource: "auto",
    placeMeta: current.placeMeta,
    houseLooks: input.houseLooks,
    landmarks: input.landmarks,
  };
  let outcome: BuildOutcome;
  try {
    outcome = (await buildInWorker(job)) ?? (await buildOnPage(job));
  } catch (e) {
    throw new Error(`Build failed: ${message(e)}`);
  }
  const result = outcome.result;
  lastWarnings = [...outcome.missing];
  progressText = "Rendering preview";
  lastPreview = await createPreview(canvas, result.model, result.plan, outcome.chunkImages, result.previewTextures);
  try {
    result.files[`${result.slug}/ui/preview.png`] = await lastPreview.snapshot(1024, 576);
  } catch {
    // keep the build's drawn preview
  }
  lastZip = zipTrack(result.files);
  lastResult = result;
  progressText = "Done";
}

window.__app = {
  route: routePins,
  build,
  progress: () => progressText,
  result: () => lastResult,
  preview: () => lastPreview,
  dataWarnings: () => [...lastWarnings],
  zip: () => lastZip,
  shot(eye, target) {
    if (!lastPreview) throw new Error("No preview: build first");
    lastPreview.view(eye, target);
    return canvas.toDataURL("image/png").split(",")[1];
  },
};
