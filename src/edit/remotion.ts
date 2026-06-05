/**
 * Remotion render — produce a synthetic, code-defined MP4 (brand intro/outro,
 * animated feature cards) from a Remotion composition the CONSUMER owns (in its
 * own demo/remotion/ folder). This is the plumbing only; no compositions ship in
 * the package (see examples/remotion/ for a tiny illustrative one).
 *
 * @remotion/bundler + @remotion/renderer are OPTIONAL peer dependencies so
 * Tauri-only consumers aren't forced to install them. They're imported lazily;
 * if absent, renderRemotion() throws a clear, actionable message.
 *
 * Honest notes: Remotion runs its OWN webpack bundle and downloads a headless
 * Chromium at render time (separate from the screencast browser). This is a
 * runtime call — it does not change the tsx / no-build authoring model.
 */
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { DemoConfig } from "../config.ts";

export interface RenderRemotionOptions {
  /** Absolute path to the consumer's Remotion entry (registers compositions). */
  entry: string;
  /** Composition id to render (as registered in the entry). */
  compositionId: string;
  /** Input props passed to the composition (must be JSON-serializable). */
  props?: Record<string, unknown>;
  /**
   * Output MP4 path. Defaults to `<video.outDir>/<compositionId>.mp4`. Within a
   * compose() montage this is a temp file the segment is normalized from.
   */
  outFile?: string;
}

const INSTALL_HINT =
  "Remotion is an optional peer dependency. Install it in the consuming app:\n" +
  "    npm i -D remotion @remotion/bundler @remotion/renderer\n" +
  "(Remotion will also download a headless Chromium on first render.)";

/** Lazily load the optional Remotion packages, with an actionable error if absent. */
async function loadRemotion(): Promise<{
  bundle: typeof import("@remotion/bundler").bundle;
  selectComposition: typeof import("@remotion/renderer").selectComposition;
  renderMedia: typeof import("@remotion/renderer").renderMedia;
}> {
  try {
    const [bundler, renderer] = await Promise.all([
      import("@remotion/bundler"),
      import("@remotion/renderer"),
    ]);
    return {
      bundle: bundler.bundle,
      selectComposition: renderer.selectComposition,
      renderMedia: renderer.renderMedia,
    };
  } catch (e) {
    throw new Error(`${INSTALL_HINT}\n\n(import failed: ${e instanceof Error ? e.message : String(e)})`);
  }
}

/**
 * Render a Remotion composition to an MP4 and return its path. Uses the config's
 * crf for quality; the composition declares its own dimensions/fps (compose()
 * normalizes the result to the master canvas like any other clip).
 */
export async function renderRemotion(
  cfg: DemoConfig,
  opts: RenderRemotionOptions,
): Promise<string> {
  const { bundle, selectComposition, renderMedia } = await loadRemotion();

  const outFile = opts.outFile ?? join(cfg.video.outDir, `${opts.compositionId}.mp4`);
  await mkdir(dirname(outFile), { recursive: true });

  console.log(`• remotion: bundling ${opts.entry}…`);
  const serveUrl = await bundle({ entryPoint: opts.entry });

  console.log(`• remotion: selecting composition "${opts.compositionId}"…`);
  const composition = await selectComposition({
    serveUrl,
    id: opts.compositionId,
    inputProps: opts.props ?? {},
  });

  console.log(`• remotion: rendering ${composition.width}x${composition.height} → ${outFile}`);
  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    outputLocation: outFile,
    inputProps: opts.props ?? {},
    crf: cfg.video.crf,
  });

  console.log(`✔ remotion: ${outFile}`);
  return outFile;
}
