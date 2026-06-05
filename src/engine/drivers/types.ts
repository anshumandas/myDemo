/**
 * The pluggable driver contract (DESIGN §6.1, now shipped).
 *
 * A driver knows how to launch + connect a WebdriverIO session against a target
 * (a Tauri binary or a real browser) and how to focus + measure that target's
 * window for capture. Scenarios never see the driver — they only touch the
 * shared {@link Helpers}, so the same scenario runs unchanged on either driver.
 */
import type { DemoConfig } from "../../config.ts";
import type { Helpers, Mark, Rect } from "../../types.ts";

export interface Session {
  /** The connected WebdriverIO session. */
  browser: WebdriverIO.Browser;
  /** Ergonomic selector helpers handed to scenarios. */
  helpers: Helpers;
  /** Timeline markers collected via helpers.mark() during the run. */
  marks: Mark[];
  /**
   * Window title used for the gdigrab `title=` capture fallback. May be resolved
   * lazily (e.g. read from `document.title` for an app-mode browser window).
   */
  captureTitle: string;
  /**
   * Focus the target window and return its client (web content) rectangle in
   * physical pixels — the region ffmpeg gdigrab records. Each driver applies the
   * right window strategy (Tauri: maximize; browser: maximize or fixed viewport).
   */
  focusMeasure(): Promise<Rect>;
  /** Tear everything down (session + spawned driver process). */
  teardown(): Promise<void>;
}

/** A pluggable driver. `start(cfg)` returns a connected, measurable session. */
export interface Driver {
  /** Stable kind, mirrors DemoConfig.driver. */
  readonly kind: DemoConfig["driver"];
  start(cfg: DemoConfig): Promise<Session>;
}

export type { Helpers, Mark, Rect };
