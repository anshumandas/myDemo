/**
 * Demo recorder — drives the real app through a scenario and produces an MP4 + GIF.
 *
 * Per scenario: reset app data → serve demo dist → launch app (tauri-driver,
 * maximized via driverArgs) → capture the window's client area → run the
 * scenario → stop ffmpeg → gifski (normalized to a fixed black-padded canvas).
 *
 * Note on ordering: capture starts *after* the window exists because we grab its
 * exact on-screen region. (Capture still brackets the entire scenario; only the
 * window must exist first.)
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { platform } from "node:os";
import type { DemoConfig } from "../config.ts";
import type { Scenario } from "../types.ts";
import { resetAppData } from "./reset.ts";
import { ensureBuilt } from "./build.ts";
import { doctor } from "./doctor.ts";
import { startSession } from "./wdio.ts";
import { startFrontendServer, startWebServer, type DevServer } from "./server.ts";
import { startCapture, mp4ToGif } from "./capture.ts";

/** Process names to kill between runs, per driver (the app/browser + its driver). */
function stragglerNames(cfg: DemoConfig): string[] {
  if (cfg.driver === "browser") {
    const b = cfg.browser;
    const browserExe = b?.name === "chrome" ? "chrome.exe" : "msedge.exe";
    const driverExe = basename(b?.name === "chrome" ? cfg.tools.chromeDriver : cfg.tools.edgeDriver);
    return [driverExe, browserExe];
  }
  return [`${cfg.app.binName}.exe`, basename(cfg.tools.edgeDriver)];
}

/** Kill any leftover app/browser + driver processes between runs (Windows). */
function killStragglers(cfg: DemoConfig): Promise<void> {
  if (platform() !== "win32") return Promise.resolve();
  const args = ["/F", "/T"];
  for (const n of stragglerNames(cfg)) args.push("/IM", n);
  return new Promise((resolve) => {
    const p = spawn("taskkill", args, { stdio: "ignore" });
    p.on("exit", () => resolve());
    p.on("error", () => resolve());
  });
}

/** Record one scenario end-to-end: launch, capture, run, encode GIF. */
export async function record(cfg: DemoConfig, scenario: Scenario): Promise<void> {
  const mp4 = join(cfg.dirs.output, `${scenario.id}.mp4`);
  const gif = join(cfg.dirs.output, `${scenario.id}.gif`);
  const timeline = join(cfg.dirs.output, `${scenario.id}.timeline.json`);

  console.log(`\n▶ ${scenario.id} — ${scenario.title}`);
  await mkdir(cfg.dirs.output, { recursive: true });
  await resetAppData(cfg);
  await killStragglers(cfg);

  // The Tauri driver serves the built dist/ via vite preview; the browser driver
  // (optionally) spawns the consumer's web server. Both expose the same handle.
  const server: DevServer =
    cfg.driver === "browser" ? await startWebServer(cfg) : await startFrontendServer(cfg);
  // The base URL the session should land on (the driver may already be there).
  const baseUrl = cfg.driver === "browser" ? cfg.browser!.url : cfg.devUrl;

  const session = await startSession(cfg);
  let capture: ReturnType<typeof startCapture> | null = null;
  try {
    const b = session.browser;
    // Force navigation: the webview/browser can open before the server is
    // reachable and get stuck on about:blank otherwise.
    await b.url(baseUrl).catch(() => undefined);
    await session.helpers.waitFor(cfg.navAnchor, 30_000);
    await session.helpers.pause(700);

    // Focus + size the target window and measure its client (web content) rect;
    // the GIF encode normalizes this to a fixed, black-padded canvas so every
    // recording is identically framed. The driver picks the window strategy.
    const region = await session.focusMeasure();
    console.log(`• capturing client ${region.w}x${region.h} @ (${region.x},${region.y})`);

    // Off-camera setup (seed prerequisite data) before capture starts.
    if (scenario.setup) {
      console.log("• setup (off camera)…");
      await scenario.setup(session.helpers);
      await session.helpers.goto("/");
      await session.helpers.waitFor(cfg.navAnchor);
      await session.helpers.pause(400);
    }

    capture = startCapture(cfg, mp4, region);
    const captureStartedAt = Date.now();
    await session.helpers.pause(700); // let ffmpeg warm up before acting
    await scenario.run(session.helpers);

    // Persist the on-camera markers (relative to capture start) so the tutorial
    // renderer can place a caption at each beat. Only scenarios that call
    // helpers.mark() produce a timeline.
    if (session.marks.length) {
      const rel = session.marks.map((m) => ({
        label: m.label,
        t: Math.max(0, (m.tAbs - captureStartedAt) / 1000),
      }));
      await writeFile(timeline, JSON.stringify({ id: scenario.id, marks: rel }, null, 2));
      console.log(`• wrote ${rel.length} timeline mark(s)`);
    }
  } finally {
    if (capture) await capture.stop();
    await session.teardown();
    server.stop();
    await killStragglers(cfg);
  }

  console.log("• encoding GIF…");
  await mp4ToGif(cfg, mp4, gif);
  console.log(`✔ ${scenario.id}\n   ${mp4}\n   ${gif}`);
}

/** Options for {@link runRecorderCli}. */
export interface RecorderCliOptions {
  cfg: DemoConfig;
  /** The app's ordered scenario registry. */
  scenarios: Scenario[];
  /**
   * Absolute path to the consumer's own recorder entry file (the one that calls
   * runRecorderCli). The orchestrator re-spawns it with `--worker` so each
   * scenario records in a fresh process (multiple WebDriver sessions in one
   * long-lived process wedge tauri-driver after a couple of runs).
   */
  entryScript: string;
  /** CLI args (typically process.argv.slice(2)). */
  argv: string[];
}

function findScenario(scenarios: Scenario[], id: string): Scenario {
  const s = scenarios.find((x) => x.id === id || x.id.startsWith(id));
  if (!s) {
    console.error(`Unknown scenario "${id}". Known: ${scenarios.map((x) => x.id).join(", ")}`);
    process.exit(1);
  }
  return s;
}

/** Run a single scenario in a FRESH child process (clean tauri-driver/Edge slate). */
function runScenarioChild(opts: RecorderCliOptions, id: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", opts.entryScript, id, "--worker"],
      { cwd: opts.cfg.rootDir, stdio: "inherit", env: opts.cfg.augmentedEnv() },
    );
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

/**
 * The recorder CLI. Mirrors the flags the host rig exposes:
 *   <id>            record one scenario
 *   --all           record every non-solo scenario (marketing-montage set)
 *   --gifs          re-encode existing MP4s → GIF (no app launch)
 *   --build         force a rebuild first
 *   --worker        internal: record exactly one scenario in-process
 */
export async function runRecorderCli(opts: RecorderCliOptions): Promise<void> {
  const { cfg, scenarios, argv } = opts;
  const force = argv.includes("--build");
  const gifsOnly = argv.includes("--gifs");
  const all = argv.includes("--all");
  const worker = argv.includes("--worker");
  const ids = argv.filter((a) => !a.startsWith("--"));

  await mkdir(cfg.dirs.output, { recursive: true });

  // Preflight tool check, once, in the parent process. Workers skip it (the
  // parent already reported); gifs-only skips the driver and just re-encodes.
  // Non-fatal by design: warn and continue so a partially-equipped run still
  // attempts to record rather than aborting before it starts.
  if (!worker && !gifsOnly) {
    const report = await doctor(cfg);
    if (!report.ok) {
      console.warn("⚠ doctor: some tools are missing — recording may fail deep in the engine. Continuing anyway.\n");
    }
  }

  if (gifsOnly) {
    const targets =
      all || ids.length === 0 ? scenarios.filter((s) => !s.solo) : ids.map((i) => findScenario(scenarios, i));
    for (const s of targets) {
      const mp4 = join(cfg.dirs.output, `${s.id}.mp4`);
      const gif = join(cfg.dirs.output, `${s.id}.gif`);
      console.log(`• re-encoding ${s.id} → GIF`);
      await mp4ToGif(cfg, mp4, gif);
    }
    console.log("✔ GIFs re-encoded");
    return;
  }

  // `--all` records the marketing-montage set only; `solo` scenarios (e.g. the
  // full tutorial) are recorded explicitly by id.
  const targets = all ? scenarios.filter((s) => !s.solo) : ids.map((i) => findScenario(scenarios, i));
  if (targets.length === 0) {
    console.error("Usage: <recorder> <scenario-id>   |   --all   |   --gifs");
    process.exit(1);
  }

  // Worker (single scenario, in-process) — or a plain single-scenario invocation,
  // which is already its own fresh process.
  if (worker || (!all && targets.length === 1)) {
    if (!worker) await ensureBuilt(cfg, force);
    let failed = false;
    for (const s of targets) {
      try {
        await record(cfg, s);
      } catch (e) {
        console.error(`✖ ${s.id} failed: ${e instanceof Error ? e.message : String(e)}`);
        failed = true;
      }
    }
    if (failed) process.exitCode = 1;
    return;
  }

  // Orchestrator: build once, then record each scenario in its own child process.
  await ensureBuilt(cfg, force);
  const failures: string[] = [];
  for (const s of targets) {
    console.log(`\n=== ${s.id} (isolated process) ===`);
    const code = await runScenarioChild(opts, s.id);
    if (code !== 0) failures.push(s.id);
  }
  const ok = targets.length - failures.length;
  console.log(`\n✅ Done — ${ok}/${targets.length} scenario(s) recorded. Output in ${cfg.dirs.output}`);
  if (failures.length) {
    console.log(`✖ Failed: ${failures.join(", ")}`);
    process.exitCode = 1;
  }
}
