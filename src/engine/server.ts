/**
 * Static server for the built demo frontend.
 *
 * The debug Tauri binary runs in dev mode and loads its UI from `devUrl`
 * (e.g. http://localhost:1420). `tauri dev` would normally provide that; for
 * capture we instead serve the already-built dist/ (compiled with the demo flag)
 * via `vite preview` on the same port, so the binary loads the demo UI unchanged.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createConnection } from "node:net";
import { join } from "node:path";
import type { DemoConfig } from "../config.ts";

function waitForPort(port: number, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const sock = createConnection({ host: "127.0.0.1", port }, () => {
        sock.end();
        resolve();
      });
      sock.on("error", () => {
        sock.destroy();
        if (Date.now() > deadline) reject(new Error(`dev server port ${port} never opened`));
        else setTimeout(tryOnce, 250);
      });
    };
    tryOnce();
  });
}

export interface DevServer {
  stop: () => void;
}

/** Parse the port out of the configured devUrl (default 1420). */
function devPort(devUrl: string): number {
  try {
    return Number(new URL(devUrl).port) || 1420;
  } catch {
    return 1420;
  }
}

/** Start `vite preview` serving dist/ on the devUrl port and resolve once reachable. */
export async function startFrontendServer(cfg: DemoConfig): Promise<DevServer> {
  const port = devPort(cfg.devUrl);
  const viteBin = join(cfg.rootDir, "node_modules", "vite", "bin", "vite.js");
  const proc: ChildProcess = spawn(
    process.execPath,
    [viteBin, "preview", "--port", String(port), "--strictPort", "--host", "127.0.0.1"],
    { cwd: cfg.rootDir, stdio: ["ignore", "inherit", "inherit"], env: cfg.augmentedEnv() },
  );
  proc.on("error", (e) => console.error("vite preview failed to spawn:", e.message));
  await waitForPort(port, 40_000);
  return { stop: () => proc.kill() };
}
