/**
 * Browser driver — drives & records a REAL headed browser (Edge by default,
 * Chrome optionally) over a web URL through plain WebdriverIO. No tauri-driver.
 *
 * We spawn the vendored driver binary ourselves (msedgedriver / chromedriver,
 * resolved from cfg.tools, same PATH-augmentation + .bin vendoring as the rest
 * of the rig) and connect WebdriverIO to it — mirroring the Tauri path's
 * spawn-then-wait-for-port shape. Headed is mandatory: gdigrab captures a
 * visible window. We launch in app/kiosk mode (`--app=<url>`) by default so the
 * frame is chrome-free (no tabs/address bar) and the captured client rect is
 * just the page.
 *
 * Routing: `h.goto("/route")` resolves against the configured base URL, in
 * "path" mode (Next.js App Router) or "hash" mode (SPA hash routers).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { remote } from "webdriverio";
import type { DemoConfig, ResolvedBrowserConfig } from "../../config.ts";
import type { Mark } from "../../types.ts";
import { focusMeasureClient } from "../win.ts";
import { buildHelpers } from "./helpers.ts";
import { waitForPort } from "./util.ts";
import type { Driver, Session } from "./types.ts";

/** Resolve a scenario route against the base URL in the configured routing mode. */
function resolveUrl(b: ResolvedBrowserConfig, route: string): string {
  if (b.routing === "hash") {
    const hash = route.startsWith("#") ? route.slice(1) : route;
    return `${b.url}/#${hash.startsWith("/") ? hash : `/${hash}`}`;
  }
  // path routing: join base + route
  const path = route.startsWith("/") ? route : `/${route}`;
  return `${b.url}${path}`;
}

/** Driver-server binary + WebdriverIO capabilities for the chosen browser. */
function plan(cfg: DemoConfig, b: ResolvedBrowserConfig): {
  bin: string;
  caps: WebdriverIO.Capabilities;
} {
  // Stability flags shared by both Chromium browsers. App mode gives a
  // chrome-free window; --window-size honors a configured viewport.
  const args: string[] = ["--no-first-run", "--no-default-browser-check"];
  if (b.appMode) args.push(`--app=${b.url}`);
  if (b.viewport) args.push(`--window-size=${b.viewport.width},${b.viewport.height}`);

  if (b.name === "chrome") {
    return {
      bin: cfg.tools.chromeDriver,
      caps: {
        browserName: "chrome",
        "goog:chromeOptions": { args },
      } as WebdriverIO.Capabilities,
    };
  }
  return {
    bin: cfg.tools.edgeDriver,
    caps: {
      browserName: "MicrosoftEdge",
      "ms:edgeOptions": { args },
    } as WebdriverIO.Capabilities,
  };
}

async function start(cfg: DemoConfig): Promise<Session> {
  const b = cfg.browser;
  if (!b) throw new Error('browser driver requires resolved cfg.browser (driver: "browser").');

  const { bin, caps } = plan(cfg, b);
  const driver: ChildProcess = spawn(bin, [`--port=${cfg.driverPort}`], {
    stdio: ["ignore", "inherit", "inherit"],
    env: cfg.augmentedEnv(),
  });
  driver.on("error", (e) => {
    console.error(`${b.name} driver failed to start:`, e.message);
  });

  await waitForPort(cfg.driverPort);

  const browser = await remote({
    hostname: "127.0.0.1",
    port: cfg.driverPort,
    path: "/",
    logLevel: "error",
    connectionRetryCount: 1,
    capabilities: caps,
  });

  const marks: Mark[] = [];
  // Web routes resolve against the base URL via a full navigation.
  const helpers = buildHelpers(browser, marks, async (route) => {
    await browser.url(resolveUrl(b, route));
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
    // App-mode windows have no stable OS title beyond the page <title>; read it
    // live (unless the consumer pinned app.windowTitle) and match by substring
    // so a trailing browser suffix doesn't defeat the lookup. A configured
    // viewport is measured as-is; otherwise the window is maximized like Tauri.
    focusMeasure: async () => {
      const title = cfg.app.windowTitle || (await browser.getTitle());
      return focusMeasureClient(title, {
        match: "contains",
        window: b.viewport ? "asis" : "maximize",
      });
    },
    teardown,
  };
}

export const browserDriver: Driver = { kind: "browser", start };
