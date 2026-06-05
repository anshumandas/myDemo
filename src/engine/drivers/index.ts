/**
 * Driver registry. `selectDriver(cfg)` returns the driver implied by
 * `cfg.driver` (default "tauri"). Scenarios never call this — the recorder does,
 * once, when it opens a session.
 */
import type { DemoConfig } from "../../config.ts";
import type { Driver, Session } from "./types.ts";
import { tauriDriver } from "./tauri.ts";
import { browserDriver } from "./browser.ts";

const DRIVERS: Record<DemoConfig["driver"], Driver> = {
  tauri: tauriDriver,
  browser: browserDriver,
};

/** Resolve the driver for a config. */
export function selectDriver(cfg: DemoConfig): Driver {
  const d = DRIVERS[cfg.driver];
  if (!d) throw new Error(`Unknown driver "${cfg.driver}" (expected "tauri" or "browser").`);
  return d;
}

export { tauriDriver, browserDriver };
export type { Driver, Session };
