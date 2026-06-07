/**
 * The shared Helpers implementation — identical for every driver. The ONLY
 * driver-specific behavior is how `goto(route)` resolves a route to a navigation
 * (Tauri uses hash routes against the in-app webview; the browser driver
 * resolves against the configured base URL in hash or path mode), so that is
 * injected as `navigate`. Everything else (click/type/uploadFile/waitFor/…) is
 * plain WebdriverIO and shared verbatim, which is what lets a scenario run
 * unchanged on either driver.
 */
import type { Helpers, Mark } from "../../types.ts";

const SEL = (testId: string) => `[data-testid="${testId}"]`;
export const DEFAULT_TIMEOUT = 15_000;

/**
 * Resolve the first *displayed* element matching a test-id, waiting until one
 * appears. Responsive apps commonly render multiple layouts and CSS-hide all but
 * one (e.g. `hidden md:block` desktop + `block md:hidden` mobile) — so the same
 * test-id exists several times in the DOM and a plain `$` returns the first,
 * often-hidden, one. A UI rig must act on what's visible, so we pick the
 * displayed match. (Hidden inputs for uploadFile are the deliberate exception.)
 */
async function firstDisplayed(
  browser: WebdriverIO.Browser,
  testId: string,
  timeoutMs: number,
): Promise<WebdriverIO.Element> {
  let found: WebdriverIO.Element | null = null;
  await browser.waitUntil(
    async () => {
      const els = await browser.$$(SEL(testId));
      for (const el of els) {
        if (await el.isDisplayed().catch(() => false)) {
          found = el;
          return true;
        }
      }
      return false;
    },
    { timeout: timeoutMs, timeoutMsg: `no displayed element [data-testid="${testId}"] within ${timeoutMs}ms` },
  );
  return found as unknown as WebdriverIO.Element;
}

/**
 * Build the Helpers surface over a connected browser.
 *
 * @param browser   the WebdriverIO session
 * @param marks     shared array the engine reads back after the run
 * @param navigate  driver-specific route → navigation
 */
export function buildHelpers(
  browser: WebdriverIO.Browser,
  marks: Mark[],
  navigate: (route: string) => Promise<void>,
): Helpers {
  return {
    browser,
    goto: (route) => navigate(route),
    async click(testId) {
      const el = await firstDisplayed(browser, testId, DEFAULT_TIMEOUT);
      await el.waitForClickable({ timeout: DEFAULT_TIMEOUT });
      await el.click();
    },
    async type(testId, text) {
      const el = await firstDisplayed(browser, testId, DEFAULT_TIMEOUT);
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
      await firstDisplayed(browser, testId, timeoutMs);
    },
    async waitForText(testId, substr, timeoutMs = DEFAULT_TIMEOUT) {
      const el = await firstDisplayed(browser, testId, timeoutMs);
      await browser.waitUntil(async () => (await el.getText()).includes(substr), {
        timeout: timeoutMs,
        timeoutMsg: `"${substr}" not in ${testId} within ${timeoutMs}ms`,
      });
    },
    async textOf(testId) {
      const el = await firstDisplayed(browser, testId, DEFAULT_TIMEOUT);
      return (await el.getText()).trim();
    },
    pause: (ms) => browser.pause(ms),
    log: (msg) => console.log(`  · ${msg}`),
    mark: (label) => {
      marks.push({ label, tAbs: Date.now() });
      console.log(`  ◆ ${label}`);
    },
  };
}
