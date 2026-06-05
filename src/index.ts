/**
 * @mydemo/core — demo-capture toolkit. Drives a built app (Tauri desktop OR a
 * web app in a real headed browser) through scripted scenarios and records
 * uniformly-framed GIFs / MP4s, then weaves them — and optional Remotion-rendered
 * intros/cards — into a finished marketing video.
 *
 * Public API consumed by an app's demo/ folder (run via tsx):
 *   - defineConfig    resolve app-specific config (paths, identity, driver, tools)
 *   - defineScenario  author a typed scenario (driver-agnostic Helpers)
 *   - runRecorderCli  the recorder CLI (single / --all / --gifs / --build / --worker)
 *   - record          record one scenario programmatically
 *   - selectDriver    resolve the driver implied by cfg.driver ("tauri" | "browser")
 *   - doctor          preflight tool check for the configured driver
 *   - ensureBuilt     build the demo bundle (Tauri only; no-op for browser)
 *   - resetAppData    wipe local state for a clean first-run
 *   - compose         render a finished video from an EDL (clips/cards/remotion)
 *   - renderRemotion  render a consumer-owned Remotion composition to MP4
 *   - renderTutorial  caption + score a single-take tutorial recording
 *
 * Every engine function takes the resolved `DemoConfig` as its first argument —
 * there is no module-level singleton, so one package serves many apps.
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
  DriverKind,
  BrowserName,
  RoutingMode,
  BrowserConfigInput,
  WebServerConfigInput,
  ResolvedBrowserConfig,
  ResolvedWebServer,
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
export { selectDriver } from "./engine/drivers/index.ts";
export type { Driver } from "./engine/drivers/index.ts";
export { doctor } from "./engine/doctor.ts";
export type { DoctorReport, DoctorCheck } from "./engine/doctor.ts";
export { startFrontendServer, startWebServer } from "./engine/server.ts";
export type { DevServer } from "./engine/server.ts";
export { startCapture, mp4ToGif } from "./engine/capture.ts";
export type { Capture } from "./engine/capture.ts";
export { focusMeasureClient } from "./engine/win.ts";
export type { MeasureOptions } from "./engine/win.ts";

// Video edit
export { compose, addMusic, normalizeFilter, escPath } from "./edit/compose.ts";
export type { VideoEdl, Segment, ClipSegment, CardSegment, RemotionSegment } from "./edit/compose.ts";
export { renderRemotion } from "./edit/remotion.ts";
export type { RenderRemotionOptions } from "./edit/remotion.ts";
export { renderTutorial } from "./edit/tutorial.ts";
