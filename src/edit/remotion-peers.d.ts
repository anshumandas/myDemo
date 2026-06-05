/**
 * Minimal ambient declarations for the OPTIONAL Remotion peer dependencies
 * (@remotion/bundler, @remotion/renderer). They let `src/edit/remotion.ts`
 * type-check (and avoid `any`) WITHOUT the packages being installed — Tauri-only
 * consumers never install Remotion. At runtime renderRemotion() dynamically
 * imports them and fails with an actionable message if they're absent.
 *
 * Only the small surface the engine uses is declared. If you extend the Remotion
 * usage, widen these to match the installed package's real types.
 */

declare module "@remotion/bundler" {
  export interface BundleOptions {
    entryPoint: string;
    /** Override the public/ directory. */
    publicDir?: string | null;
    /** Progress callback (0–100). */
    onProgress?: (progress: number) => void;
    /** Webpack config override. */
    webpackOverride?: (config: unknown) => unknown;
  }
  /** Bundle a Remotion entry and return a serve URL (a local directory path). */
  export function bundle(options: BundleOptions): Promise<string>;
}

declare module "@remotion/renderer" {
  /** Resolved composition metadata (subset). */
  export interface VideoConfig {
    id: string;
    width: number;
    height: number;
    fps: number;
    durationInFrames: number;
    defaultProps: Record<string, unknown>;
    props: Record<string, unknown>;
  }

  export interface SelectCompositionOptions {
    serveUrl: string;
    id: string;
    inputProps?: Record<string, unknown>;
  }
  export function selectComposition(options: SelectCompositionOptions): Promise<VideoConfig>;

  export interface RenderMediaOptions {
    composition: VideoConfig;
    serveUrl: string;
    codec: "h264" | "h265" | "vp8" | "vp9" | "prores" | "gif";
    outputLocation: string;
    inputProps?: Record<string, unknown>;
    crf?: number;
    onProgress?: (p: { progress: number }) => void;
  }
  export function renderMedia(options: RenderMediaOptions): Promise<{ buffer: Buffer | null }>;
}
