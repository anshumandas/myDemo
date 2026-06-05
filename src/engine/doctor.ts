/**
 * Preflight tool check. The rig deliberately does NOT bundle external binaries
 * (tauri-driver, ffmpeg, gifski, ffprobe, the browser-driver); it augments PATH
 * (config.augmentedEnv) and relies on this `doctor` to report what's missing
 * before a recording fails deep inside the engine.
 *
 * The set of checks depends on cfg.driver: the Tauri driver needs tauri-driver +
 * the vendored WebView2 driver; the browser driver needs the vendored
 * msedgedriver/chromedriver instead. ffmpeg/gifski/ffprobe are common to both.
 */
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import type { DemoConfig } from "../config.ts";

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface DoctorReport {
  ok: boolean;
  checks: DoctorCheck[];
}

const exists = (p: string) => access(p).then(() => true, () => false);

/** True if `cmd` can be spawned (resolves on PATH); exit code is irrelevant. */
function commandResolves(cmd: string, args: string[], env: NodeJS.ProcessEnv): Promise<boolean> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: "ignore", env });
    p.on("error", () => resolve(false)); // ENOENT → not on PATH
    p.on("exit", () => resolve(true));
  });
}

/** Check a PATH command, reporting it under `name`. */
async function checkCommand(
  name: string,
  cmd: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<DoctorCheck> {
  const ok = await commandResolves(cmd, args, env);
  return { name, ok, detail: ok ? `found: ${cmd}` : `not found on PATH: ${cmd}` };
}

/** Check a vendored/absolute binary file path. */
async function checkFile(name: string, path: string): Promise<DoctorCheck> {
  const ok = path ? await exists(path) : false;
  return { name, ok, detail: ok ? `found: ${path}` : `missing: ${path || "(unset)"}` };
}

/**
 * Run the preflight checks for `cfg`. Logs a short report and returns it; the
 * caller decides whether to abort (`report.ok`).
 */
export async function doctor(cfg: DemoConfig): Promise<DoctorReport> {
  const env = cfg.augmentedEnv();
  const checks: DoctorCheck[] = [
    await checkCommand("ffmpeg", cfg.tools.ffmpeg, ["-version"], env),
    await checkCommand("ffprobe", "ffprobe", ["-version"], env),
    await checkCommand("gifski", cfg.tools.gifski, ["--version"], env),
  ];

  if (cfg.driver === "browser") {
    const b = cfg.browser;
    if (b?.name === "chrome") {
      checks.push(await checkFile("chromedriver", cfg.tools.chromeDriver));
    } else {
      checks.push(await checkFile("msedgedriver", cfg.tools.edgeDriver));
    }
  } else {
    checks.push(await checkCommand("tauri-driver", cfg.tools.tauriDriver, ["--help"], env));
    checks.push(await checkFile("msedgedriver", cfg.tools.edgeDriver));
  }

  const ok = checks.every((c) => c.ok);
  console.log(`\n• doctor (driver: ${cfg.driver})`);
  for (const c of checks) console.log(`  ${c.ok ? "✓" : "✗"} ${c.name.padEnd(14)} ${c.detail}`);
  console.log(ok ? "✔ all tools present\n" : "✖ some tools are missing (see above)\n");
  return { ok, checks };
}
