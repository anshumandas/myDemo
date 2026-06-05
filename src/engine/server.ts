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
import { get as httpGet } from "node:http";
import { get as httpsGet } from "node:https";
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

/** Poll an HTTP(S) URL until it answers (any status), or reject after timeout. */
function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const getter = url.startsWith("https:") ? httpsGet : httpGet;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = getter(url, (res) => {
        res.resume(); // drain
        resolve();
      });
      req.on("error", () => {
        req.destroy();
        if (Date.now() > deadline) reject(new Error(`readyUrl ${url} never answered in ${timeoutMs}ms`));
        else setTimeout(tryOnce, 400);
      });
    };
    tryOnce();
  });
}

/** Best-effort port extraction from a URL (http→80, https→443 if unspecified). */
function urlPort(url: string): number {
  try {
    const u = new URL(url);
    if (u.port) return Number(u.port);
    return u.protocol === "https:" ? 443 : 80;
  } catch {
    return 80;
  }
}

/**
 * Web-server lifecycle for the browser driver — the analogue of
 * {@link startFrontendServer}. Spawns the configured `command`, waits for the
 * readiness signal (an HTTP `readyUrl`, else a TCP probe of the app URL's port),
 * and returns a stoppable handle. If no `webServer` is configured the app is
 * assumed to already be running at `browser.url` (a no-op handle is returned).
 *
 * Note: the engine still waits for the in-page `navAnchor` after navigating, so
 * `readyTestId` readiness is covered there regardless of the server signal.
 */
export async function startWebServer(cfg: DemoConfig): Promise<DevServer> {
  const b = cfg.browser;
  if (!b) throw new Error('startWebServer requires driver: "browser".');

  const ws = b.webServer;
  if (!ws) {
    console.log(`• no webServer configured — assuming app is already running at ${b.url}`);
    return { stop: () => undefined };
  }

  const isShell = typeof ws.command === "string";
  const [cmd, ...args] = isShell ? [ws.command as string] : (ws.command as string[]);
  console.log(`• starting web server: ${Array.isArray(ws.command) ? ws.command.join(" ") : ws.command}`);
  const proc: ChildProcess = spawn(cmd, args, {
    cwd: ws.cwd,
    shell: isShell,
    stdio: ["ignore", "inherit", "inherit"],
    env: cfg.augmentedEnv(ws.env),
  });
  proc.on("error", (e) => console.error("web server failed to spawn:", e.message));

  if (ws.readyUrl) {
    await waitForHttp(ws.readyUrl, ws.startupTimeoutMs);
  } else {
    await waitForPort(urlPort(b.url), ws.startupTimeoutMs);
  }
  console.log("• web server ready");
  return { stop: () => proc.kill() };
}
