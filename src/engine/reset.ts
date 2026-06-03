/**
 * Wipe the app's local state so every recording starts from a clean first-run:
 * delete the configured reset files (SQLite DB + sidecars, vault snapshot, …)
 * from the per-user app-data dir. Safe to run repeatedly; missing files ignored.
 */
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { DemoConfig } from "../config.ts";

export async function resetAppData(cfg: DemoConfig): Promise<void> {
  const dir = cfg.appDataDir();
  for (const name of cfg.resetFiles) {
    const path = join(dir, name);
    try {
      await rm(path, { force: true });
    } catch (e) {
      // force:true already swallows ENOENT; anything else is worth surfacing.
      console.warn(`reset: could not delete ${path}: ${(e as Error).message}`);
    }
  }
  console.log(`reset: cleared app data in ${dir}`);
}
