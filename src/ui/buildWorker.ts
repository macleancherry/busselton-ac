// The build worker: runs the whole build (pipeline.ts) off the page's main thread, so the
// headless script's progress polls keep answering, and moves the big buffers back without copying.
// docs/specs/headless-page.md, "Worker".

import { runBuild, type BuildJob } from "../services/pipeline";
import { transferBuffers, type WorkerMessage } from "./workerProtocol";

const post = (msg: WorkerMessage, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);

function canDraw(): boolean {
  try {
    return typeof OffscreenCanvas !== "undefined" && !!new OffscreenCanvas(1, 1).getContext("2d");
  } catch {
    return false;
  }
}

self.onmessage = async (e: MessageEvent<BuildJob>) => {
  if (!canDraw()) {
    post({ type: "unsupported" });
    return;
  }
  try {
    const { chunkImages, ...outcome } = await runBuild(
      e.data,
      async (stage, fraction = 0) => post({ type: "progress", stage, fraction }),
      (text) => post({ type: "trace", text }),
    );
    const images: [string, ImageBitmap][] = [...chunkImages].map(([key, canvas]) => [key, canvas.transferToImageBitmap()]);
    post({ type: "done", outcome, images }, [...images.map(([, b]) => b), ...transferBuffers(outcome.result)]);
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
