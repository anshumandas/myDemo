/**
 * Public contracts authored against by scenario authors (and LLMs).
 *
 * `run` drives the live app through real interactions; the engine handles
 * launch, window framing, screen capture, and GIF encoding around it.
 */

/** Small, ergonomic helpers handed to every scenario (thin wrappers over WDIO). */
export interface Helpers {
  /** The connected WebdriverIO session, for anything the helpers don't cover. */
  browser: WebdriverIO.Browser;
  /** Navigate by hash route (e.g. "/import") — for screens not in the nav. */
  goto(route: string): Promise<void>;
  /** Click an element by selector id (waits for it to be clickable first). */
  click(testId: string): Promise<void>;
  /** Clear + type into an input by selector id. */
  type(testId: string, text: string): Promise<void>;
  /** Set an <input type="file"> (by selector id) to an absolute local path. */
  uploadFile(testId: string, absPath: string): Promise<void>;
  /** Wait until an element with the given selector id is displayed. */
  waitFor(testId: string, timeoutMs?: number): Promise<void>;
  /** Wait until the element's visible text contains `substr`. */
  waitForText(testId: string, substr: string, timeoutMs?: number): Promise<void>;
  /** Read the trimmed visible text of an element. */
  textOf(testId: string): Promise<string>;
  /** Deliberate pause so the recording reads naturally (not a sync hack). */
  pause(ms: number): Promise<void>;
  /** Narrate progress to the console during a run. */
  log(msg: string): void;
  /**
   * Drop a timestamped marker on the recording timeline. Each mark's text
   * becomes an on-screen caption in the tutorial video, shown from this moment
   * until the next mark. Timestamps are relative to when capture started, so
   * mark() only carries meaning inside `run` (on camera), not in `setup`.
   */
  mark(label: string): void;
}

export interface Scenario {
  /** Stable id; also the output file stem, e.g. "01-basic-import". */
  id: string;
  /** Human title for logs. */
  title: string;
  /** One-line description of what the resulting GIF demonstrates. */
  shows: string;
  /**
   * Exclude from the `--all` (marketing-montage) set. Set for standalone
   * artifacts like a full single-take tutorial, which is recorded on its own
   * and isn't one of the short feature clips the marketing cut is built from.
   */
  solo?: boolean;
  /**
   * Optional off-camera setup, run AFTER launch but BEFORE capture starts —
   * seed prerequisite data (e.g. import a sample so there are accounts) so the
   * recorded `run` can focus on the feature itself. Not part of the GIF.
   */
  setup?(h: Helpers): Promise<void>;
  /** Drive the app (on camera). Throwing aborts the recording (the MP4 is discarded). */
  run(h: Helpers): Promise<void>;
}

/** Identity helper: gives a scenario object full type-checking + IDE autocomplete. */
export function defineScenario(s: Scenario): Scenario {
  return s;
}

/** A timeline marker captured during a run (absolute wall-clock ms). */
export interface Mark {
  label: string;
  tAbs: number;
}

/** An on-screen rectangle in physical pixels. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
