/**
 * Screen capture + GIF encode.
 *
 *  - startCapture(): ffmpeg gdigrab records the named window to an MP4. Stopped
 *    gracefully by writing "q" to ffmpeg's stdin so the MP4 finalizes cleanly.
 *  - mp4ToGif(): the installed gifski takes PNG frames or a .y4m file (not MP4),
 *    so we transcode MP4 → downscaled .y4m with ffmpeg, then gifski → GIF.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { rm } from "node:fs/promises";
import type { DemoConfig } from "../config.ts";
import type { Rect } from "../types.ts";

export interface Capture {
  /** Stop recording and resolve once the MP4 is finalized on disk. */
  stop: () => Promise<void>;
}

/**
 * Begin capturing to `outMp4`. With a `region`, grabs that exact desktop
 * rectangle (correct pixels for GPU-composited WebView2); without one, falls
 * back to grabbing the window by title.
 */
export function startCapture(cfg: DemoConfig, outMp4: string, region?: Rect): Capture {
  const input = region
    ? [
        "-f", "gdigrab",
        "-framerate", String(cfg.capture.fps),
        "-offset_x", String(region.x),
        "-offset_y", String(region.y),
        "-video_size", `${region.w}x${region.h}`,
        "-i", "desktop",
      ]
    : [
        "-f", "gdigrab",
        "-framerate", String(cfg.capture.fps),
        "-i", `title=${cfg.app.windowTitle}`,
      ];

  const ff: ChildProcess = spawn(
    cfg.tools.ffmpeg,
    [
      "-y",
      ...input,
      // yuv420p needs even dimensions; round down to be safe.
      "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-pix_fmt", "yuv420p",
      outMp4,
    ],
    { stdio: ["pipe", "ignore", "inherit"], env: cfg.augmentedEnv() },
  );

  const exited = new Promise<void>((resolve) => ff.on("exit", () => resolve()));

  return {
    stop: async () => {
      try {
        ff.stdin?.write("q");
        ff.stdin?.end();
      } catch {
        /* stdin may be closed */
      }
      const timeout = new Promise<void>((resolve) =>
        setTimeout(() => {
          ff.kill("SIGINT");
          resolve();
        }, 6000),
      );
      await Promise.race([exited, timeout]);
      await exited.catch(() => undefined);
    },
  };
}

/** Run a command to completion, rejecting on non-zero exit. */
function run(cmd: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "ignore", "inherit"], env });
    p.on("error", reject);
    p.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`)),
    );
  });
}

/**
 * Transcode an MP4 to an optimized GIF via a temporary .y4m intermediate.
 * The source is scaled to fit the fixed canvas and black-padded to exactly
 * those dimensions, so every GIF is identically framed.
 */
export async function mp4ToGif(cfg: DemoConfig, mp4: string, gif: string): Promise<void> {
  const env = cfg.augmentedEnv();
  const y4m = mp4.replace(/\.mp4$/i, ".y4m");
  const { w, h } = cfg.capture.gifCanvas;
  const filter =
    `fps=${cfg.capture.gifFps},` +
    `scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=lanczos,` +
    `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black`;
  await run(cfg.tools.ffmpeg, ["-y", "-i", mp4, "-vf", filter, "-pix_fmt", "yuv420p", y4m], env);
  try {
    await run(
      cfg.tools.gifski,
      [
        y4m,
        "--fps", String(cfg.capture.gifFps),
        "--width", String(w),
        "--height", String(h),
        "--quality", "90",
        "-o", gif,
      ],
      env,
    );
  } finally {
    await rm(y4m, { force: true });
  }
}
