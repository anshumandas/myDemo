/**
 * Build the app for demo capture:
 *   1. frontend build with the demo flag(s) (cfg.build.frontendEnv) → dist/.
 *      This is the only place the demo flag is baked in (auto-unlock vault,
 *      fixed dialog paths — the app's demo-mode contract).
 *   2. native build (debug) → the binary tauri-driver launches; it embeds dist/.
 *
 * Native builds link incrementally, so re-running after the first compile is quick.
 */
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";
import type { DemoConfig } from "../config.ts";

function run(
  cmd: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`  $ ${cmd} ${args.join(" ")}`);
    const p = spawn(cmd, args, { cwd, stdio: "inherit", env });
    p.on("error", reject);
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}

const exists = (p: string) => access(p).then(() => true, () => false);

/** Build dist/ with the demo flag(s) set. */
export async function buildFrontend(cfg: DemoConfig): Promise<void> {
  console.log("• building frontend (demo mode)…");
  // The frontend build is run through the locally-installed vite to match the
  // host toolchain (and survive PATH gaps); cmd is always "vite" today.
  const viteBin = join(cfg.rootDir, "node_modules", "vite", "bin", "vite.js");
  await run(
    process.execPath,
    [viteBin, ...cfg.build.frontend.args],
    cfg.rootDir,
    cfg.augmentedEnv(cfg.build.frontendEnv),
  );
}

/** Build the debug native binary. */
export async function buildNative(cfg: DemoConfig): Promise<void> {
  console.log(`• building native debug binary (${cfg.build.native.cmd})…`);
  await run(cfg.build.native.cmd, cfg.build.native.args, cfg.tauriDir, cfg.augmentedEnv());
}

/**
 * Ensure both artifacts exist. With `force`, always rebuild (use after editing
 * components/selectors so the recorded UI is current).
 */
export async function ensureBuilt(cfg: DemoConfig, force = false): Promise<void> {
  // The browser driver has no Tauri frontend/native artifacts to build; the web
  // app's own build/serve is the consumer's webServer.command (server.ts).
  if (cfg.driver === "browser") return;
  const haveDist = await exists(join(cfg.dirs.dist, "index.html"));
  const haveBin = await exists(cfg.appBinary);
  if (force || !haveDist) await buildFrontend(cfg);
  if (force || !haveBin) await buildNative(cfg);
}
