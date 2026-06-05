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
      await browser.waitUntil(async () => (await el.getText()).includes(substr), {
        timeout: timeoutMs,
        timeoutMsg: `"${substr}" not in ${testId} within ${timeoutMs}ms`,
      });
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
}
