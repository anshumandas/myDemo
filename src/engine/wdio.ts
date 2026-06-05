/**
 * WebDriver entrypoint. Historically this file hardcoded tauri-driver + a `wry`
 * session. That impl now lives behind a pluggable driver abstraction
 * (src/engine/drivers/) so the same scenarios can also drive a real browser.
 *
 * `startSession(cfg)` selects the driver from `cfg.driver` (default "tauri") and
 * returns a connected session + shared Helpers + a window-measure/teardown — the
 * public surface is unchanged, so existing Tauri consumers keep working.
 */
import type { DemoConfig } from "../config.ts";
import { selectDriver } from "./drivers/index.ts";
import type { Session } from "./drivers/types.ts";

export type { Session } from "./drivers/types.ts";

/** Open a connected WebdriverIO session for the configured driver. */
export function startSession(cfg: DemoConfig): Promise<Session> {
  return selectDriver(cfg).start(cfg);
}
