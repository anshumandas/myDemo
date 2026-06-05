/**
 * Tauri driver — today's behavior, extracted verbatim from the original
 * wdio.ts. Launches tauri-driver (bridged to the native WebView2 driver),
 * opens a WebdriverIO session against the built app binary, and exposes the
 * shared Helpers. Routing is by hash (`window.location.hash`). Stays the
 * DEFAULT driver.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { remote } from "webdriverio";
import type { DemoConfig } from "../../config.ts";
import type { Mark } from "../../types.ts";
import { focusMeasureClient } from "../win.ts";
import { buildHelpers } from "./helpers.ts";
import { waitForPort } from "./util.ts";
import type { Driver, Session } from "./types.ts";

/** Launch tauri-driver and connect WebdriverIO to the built app binary. */
async function start(cfg: DemoConfig): Promise<Session> {
  const driver: ChildProcess = spawn(
    cfg.tools.tauriDriver,
    ["--port", String(cfg.driverPort), "--native-driver", cfg.tools.edgeDriver],
    { stdio: ["ignore", "inherit", "inherit"], env: cfg.augmentedEnv() },
  );
  driver.on("error", (e) => {
    console.error("tauri-driver failed to start:", e.message);
  });

  await waitForPort(cfg.driverPort);

  const browser = await remote({
    hostname: "127.0.0.1",
    port: cfg.driverPort,
    path: "/",
    logLevel: "error",
    connectionRetryCount: 1,
    capabilities: {
      browserName: "wry",
      // tauri-driver reads this and tells the native driver which binary to
      // launch. driverArgs (e.g. ["--demo"]) is forwarded to the app.
      "tauri:options": { application: cfg.appBinary, args: cfg.driverArgs },
    } as WebdriverIO.Capabilities,
  });

  const marks: Mark[] = [];
  // Tauri routes are hash routes set on the in-app webview.
  const helpers = buildHelpers(browser, marks, async (route) => {
    const hash = route.startsWith("#") ? route : `#${route}`;
    await browser.execute((h: string) => {
      window.location.hash = h;
    }, hash);
  });

  const teardown = async () => {
    try {
      await browser.deleteSession();
    } catch {
      /* session may already be gone */
    }
    driver.kill();
  };

  return {
    browser,
    helpers,
    marks,
    captureTitle: cfg.app.windowTitle,
    focusMeasure: () => focusMeasureClient(cfg.app.windowTitle),
    teardown,
  };
}

export const tauriDriver: Driver = { kind: "tauri", start };
