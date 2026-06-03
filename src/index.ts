/**
 * @mydemo/core — Tauri demo-capture toolkit.
 *
 * Public API consumed by an app's demo/ folder (run via tsx):
 *   - defineConfig    resolve app-specific config (paths, identity, tools)
 *   - defineScenario  author a typed scenario
 *   - runRecorderCli  the recorder CLI (single / --all / --gifs / --build)
 *   - record          record one scenario programmatically
 *   - ensureBuilt     build the demo bundle (frontend demo-mode + native)
 *   - resetAppData    wipe local state for a clean first-run
 *   - compose         render a finished video from an EDL
 *   - renderTutorial  caption + score a single-take tutorial recording
 */

// Config + scenario authoring
export { defineConfig } from "./config.ts";
export type {
  DemoConfig,
  DemoConfigInput,
  AppIdentity,
  CaptureConfig,
  VideoConfig,
  ToolsConfig,
  Dirs,
} from "./config.ts";

export { defineScenario } from "./types.ts";
export type { Scenario, Helpers, Mark, Rect } from "./types.ts";

// Recorder engine
export { record, runRecorderCli } from "./engine/record.ts";
export type { RecorderCliOptions } from "./engine/record.ts";
export { ensureBuilt, buildFrontend, buildNative } from "./engine/build.ts";
export { resetAppData } from "./engine/reset.ts";
export { startSession } from "./engine/wdio.ts";
export type { Session } from "./engine/wdio.ts";
export { startFrontendServer } from "./engine/server.ts";
export type { DevServer } from "./engine/server.ts";
export { startCapture, mp4ToGif } from "./engine/capture.ts";
export type { Capture } from "./engine/capture.ts";
export { focusMeasureClient } from "./engine/win.ts";

// Video edit
export { compose, addMusic, normalizeFilter, escPath } from "./edit/compose.ts";
export type { VideoEdl, Segment, ClipSegment, CardSegment } from "./edit/compose.ts";
export { renderTutorial } from "./edit/tutorial.ts";
