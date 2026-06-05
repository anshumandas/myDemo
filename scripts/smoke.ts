/**
 * Module-graph smoke test, run by tsx (no build step). Resolves the public
 * barrel + the new driver/remotion modules, asserts the expected exports exist,
 * and exercises the pure parts (defineConfig for BOTH drivers + per-driver
 * validation) WITHOUT launching a browser, ffmpeg, or Remotion. Catches a broken
 * import graph or a regressed config contract in CI.
 *
 *   npm run smoke
 */
import { strict as assert } from "node:assert";
import * as core from "../src/index.ts";
import { selectDriver } from "../src/engine/drivers/index.ts";

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures++;
    console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

console.log("• barrel exports");
for (const name of [
  "defineConfig",
  "defineScenario",
  "record",
  "runRecorderCli",
  "selectDriver",
  "doctor",
  "ensureBuilt",
  "resetAppData",
  "startSession",
  "startFrontendServer",
  "startWebServer",
  "startCapture",
  "mp4ToGif",
  "focusMeasureClient",
  "compose",
  "renderRemotion",
  "renderTutorial",
] as const) {
  check(name, () => assert.equal(typeof (core as Record<string, unknown>)[name], "function", "not a function"));
}

console.log("• tauri config (backward compat)");
const tauri = core.defineConfig({
  rootDir: "C:/app",
  demoDir: "C:/app/demo",
  app: { windowTitle: "myFinance", identifier: "com.myfinance.app", binName: "myfinance" },
  devUrl: "http://localhost:1420/",
  navAnchor: "nav-dashboard",
  resetFiles: ["app.db"],
});
check("driver defaults to tauri", () => assert.equal(tauri.driver, "tauri"));
check("tauri appBinary derived", () => assert.ok(tauri.appBinary.includes("myfinance")));
check("tauri selects tauri driver", () => assert.equal(selectDriver(tauri).kind, "tauri"));
check("tauri has no resolved browser", () => assert.equal(tauri.browser, undefined));

console.log("• browser config");
const web = core.defineConfig({
  rootDir: "C:/kahaniverse",
  demoDir: "C:/kahaniverse/demo",
  driver: "browser",
  navAnchor: "nav-home",
  browser: {
    name: "edge",
    url: "http://localhost:3000/",
    routing: "path",
    webServer: { command: "npm run dev", readyUrl: "http://localhost:3000" },
  },
});
check("driver is browser", () => assert.equal(web.driver, "browser"));
check("browser url trailing slash trimmed", () => assert.equal(web.browser?.url, "http://localhost:3000"));
check("browser routing path", () => assert.equal(web.browser?.routing, "path"));
check("browser appMode defaults true", () => assert.equal(web.browser?.appMode, true));
check("browser webServer cwd defaults to rootDir", () =>
  assert.equal(web.browser?.webServer?.cwd, "C:/kahaniverse"));
check("browser selects browser driver", () => assert.equal(selectDriver(web).kind, "browser"));
check("browser chromeDriver path resolved", () => assert.ok(web.tools.chromeDriver.includes("chromedriver")));

console.log("• per-driver validation");
check("tauri missing app throws", () =>
  assert.throws(() =>
    core.defineConfig({ rootDir: "C:/a", demoDir: "C:/a/demo", navAnchor: "x" } as never),
  ));
check("browser missing url throws", () =>
  assert.throws(() =>
    core.defineConfig({
      rootDir: "C:/a",
      demoDir: "C:/a/demo",
      driver: "browser",
      navAnchor: "x",
    } as never),
  ));
check("browser block on tauri throws", () =>
  assert.throws(() =>
    core.defineConfig({
      rootDir: "C:/a",
      demoDir: "C:/a/demo",
      app: { windowTitle: "A", identifier: "a", binName: "a" },
      devUrl: "http://localhost:1420/",
      navAnchor: "x",
      browser: { url: "http://localhost:3000" },
    } as never),
  ));

if (failures) {
  console.error(`\n✖ smoke: ${failures} check(s) failed`);
  process.exit(1);
}
console.log("\n✔ smoke: module graph + config contract OK");
