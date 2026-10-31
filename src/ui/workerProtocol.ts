// Messages between the headless page and its build worker, and the pure parts of handling
// them (docs/specs/headless-page.md, "Worker"). No DOM: tested in Node.

import { LocalProjection } from "../core/geo";
import type { BuildOutcome } from "../services/pipeline";

export type WorkerOutcome = Omit<BuildOutcome, "chunkImages">;

export type WorkerMessage =
  | { type: "unsupported" }
  | { type: "progress"; stage: string; fraction: number }
  | { type: "trace"; text: string }
  | { type: "error"; message: string }
  | { type: "done"; outcome: WorkerOutcome; images: [string, ImageBitmap][] };

/** The distinct ArrayBuffers behind the result's files, kn5 textures and preview pixels (moved, not copied). */
export function transferBuffers(result: Pick<WorkerOutcome["result"], "files" | "model" | "previewTextures">): ArrayBuffer[] {
  const seen = new Set<ArrayBuffer>();
  const add = (view: ArrayBufferView | undefined) => {
    const b = view?.buffer;
    if (b instanceof ArrayBuffer) seen.add(b);
  };
  for (const f of Object.values(result.files)) add(f);
  for (const t of result.model.textures) add(t.data);
  for (const t of Object.values(result.previewTextures)) add(t.rgba);
  return [...seen];
}

/** Class instances don't survive the copy out of the worker: the projection is rebuilt from its origin. */
export function restoreOutcome(outcome: WorkerOutcome): WorkerOutcome {
  outcome.result.proj = new LocalProjection(outcome.result.proj.origin);
  return outcome;
}

/** What the page does with each thing the worker says. */
export type ReplyAction =
  | { kind: "progress"; text: string }
  | { kind: "done"; outcome: WorkerOutcome; images: [string, ImageBitmap][] }
  | { kind: "reject"; message: string }
  /** The worker can't build (no OffscreenCanvas, or it never started): build on the page. */
  | { kind: "onPage" };

/** Progress text: the stage, with its percentage while fetching aerial imagery. */
export function stageText(stage: string, fraction = 0): string {
  return stage === "Fetching aerial imagery" ? `${stage} (${Math.round(fraction * 100)}%)` : stage;
}

/** Turns worker events into actions; `heard` is whether any message has arrived yet. */
export class ReplyState {
  heard = false;

  message(msg: WorkerMessage): ReplyAction {
    this.heard = true;
    switch (msg.type) {
      case "unsupported": return { kind: "onPage" };
      case "progress": return { kind: "progress", text: stageText(msg.stage, msg.fraction) };
      case "trace": return { kind: "progress", text: msg.text };
      case "error": return { kind: "reject", message: msg.message };
      case "done": return { kind: "done", outcome: restoreOutcome(msg.outcome), images: msg.images };
    }
  }

  /** The worker failed to load or crashed. */
  error(message?: string): ReplyAction {
    return this.heard ? { kind: "reject", message: message || "The build stopped unexpectedly" } : { kind: "onPage" };
  }
}
