/**
 * WebDriver plumbing: start tauri-driver (bridged to the native WebView2
 * driver), open a WebdriverIO session against the built app binary, expose
 * ergonomic selector helpers to scenarios, and tear everything down cleanly.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createConnection } from "node:net";
import { remote } from "webdriverio";
import type { DemoConfig } from "../config.ts";
import type { Helpers, Mark } from "../types.ts";

const SEL = (testId: string) => `[data-testid="${testId}"]`;
const DEFAULT_TIMEOUT = 15_000;

/** Resolve once a TCP port accepts connections, or reject after `timeoutMs`. */
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
        if (Date.now() > deadline) reject(new Error(`port ${port} not open after ${timeoutMs}ms`));
        else setTimeout(tryOnce, 250);
      });
    };
    tryOnce();
  });
}

export interface Session {
  browser: WebdriverIO.Browser;
  helpers: Helpers;
  /** Timeline markers collected via helpers.mark() during the run. */
  marks: Mark[];
  teardown: () => Promise<void>;
}

/** Launch tauri-driver and connect WebdriverIO to the built app binary. */
export async function startSession(cfg: DemoConfig): Promise<Session> {
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

  const helpers: Helpers = {
    browser,
    async goto(route) {
      const hash = route.startsWith("#") ? route : `#${route}`;
      await browser.execute((h: string) => {
        window.location.hash = h;
      }, hash);
    },
    async click(testId) {
      const el = await browser.$(SEL(testId));
      await el.waitForClickable({ timeout: DEFAULT_TIMEOUT });
      await el.click();
    },
    async type(testId, text) {
      const el = await browser.$(SEL(testId));
      await el.waitForDisplayed({ timeout: DEFAULT_TIMEOUT });
      await el.setValue(text);
    },
    async uploadFile(testId, absPath) {
      // Hidden file inputs are never "displayed"; just wait for existence and
      // push the path through the WebDriver file-upload channel.
      const el = await browser.$(SEL(testId));
      await el.waitForExist({ timeout: DEFAULT_TIMEOUT });
      await el.addValue(absPath);
    },
    async waitFor(testId, timeoutMs = DEFAULT_TIMEOUT) {
      const el = await browser.$(SEL(testId));
      await el.waitForDisplayed({ timeout: timeoutMs });
    },
    async waitForText(testId, substr, timeoutMs = DEFAULT_TIMEOUT) {
      const el = await browser.$(SEL(testId));
      await el.waitForDisplayed({ timeout: timeoutMs });
      await browser.waitUntil(
        async () => (await el.getText()).includes(substr),
        { timeout: timeoutMs, timeoutMsg: `"${substr}" not in ${testId} within ${timeoutMs}ms` },
      );
    },
    async textOf(testId) {
      const el = await browser.$(SEL(testId));
      return (await el.getText()).trim();
    },
    pause: (ms) => browser.pause(ms),
    log: (msg) => console.log(`  · ${msg}`),
    mark: (label) => {
      marks.push({ label, tAbs: Date.now() });
      console.log(`  ◆ ${label}`);
    },
  };

  const teardown = async () => {
    try {
      await browser.deleteSession();
    } catch {
      /* session may already be gone */
    }
    driver.kill();
  };

  return { browser, helpers, marks, teardown };
}
