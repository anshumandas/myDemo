/**
 * Video compose engine — turns the rig's raw per-scenario MP4s into a finished,
 * edited video. Pure ffmpeg (already a rig dependency); no NLE, no new tooling.
 *
 * A {@link VideoEdl} is a declarative edit list: an ordered list of segments,
 * each either a recorded CLIP (with an in/out slice and an optional speed ramp +
 * caption) or a generated title CARD, plus an optional music bed. compose():
 *
 *   1. renders every segment to a normalized intermediate (same canvas, fps,
 *      pixel format, SAR) so they can be joined seamlessly;
 *   2. probes each intermediate's exact duration;
 *   3. crossfades them together with xfade (or hard-cuts if transition is 0);
 *   4. lays a faded, volume-ducked music bed under the whole thing.
 *
 * Captions and card text are written to temp files and referenced via drawtext
 * `textfile=` so arbitrary punctuation needs no filtergraph escaping.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DemoConfig } from "../config.ts";
import { renderRemotion } from "./remotion.ts";

/** A recorded clip sliced from a scenario MP4. */
export interface ClipSegment {
  kind: "clip";
  /** Absolute path to the source MP4 (typically <output>/<id>.mp4). */
  source: string;
  /** Start offset within the source, seconds. */
  in: number;
  /** End offset within the source, seconds. */
  out: number;
  /** Playback rate: 1 = realtime, 2 = twice as fast (speeds up dull stretches). */
  rate?: number;
  /** Optional lower-third caption burned over this segment. */
  caption?: string;
}

/** A generated full-screen title/section card. */
export interface CardSegment {
  kind: "card";
  title: string;
  subtitle?: string;
  /** On-screen duration, seconds. */
  duration: number;
  /** Background color (ffmpeg color syntax). Defaults to near-black. */
  bg?: string;
}

/**
 * A segment sourced from a Remotion render (brand intro/outro, animated feature
 * card). The composition is rendered to a temp MP4, then normalized to the
 * master canvas and joined exactly like a recorded clip — so a montage can weave
 * synthetic and screencast segments together seamlessly.
 */
export interface RemotionSegment {
  kind: "remotion";
  /** Absolute path to the consumer's Remotion entry (registers compositions). */
  entry: string;
  /** Composition id to render. */
  compositionId: string;
  /** Input props passed to the composition (JSON-serializable). */
  props?: Record<string, unknown>;
  /** Optional lower-third caption burned over this segment. */
  caption?: string;
}

export type Segment = ClipSegment | CardSegment | RemotionSegment;

export interface VideoEdl {
  /** Output file stem (e.g. "marketing"). */
  id: string;
  /** Crossfade between consecutive segments, seconds. 0 = hard cuts. */
  transition?: number;
  /** Optional background music. */
  music?: {
    /** Absolute path to an audio file. */
    file: string;
    /** Linear gain applied to the track (0–1). Default 0.6. */
    volume?: number;
    /** Fade-in / fade-out, seconds. Default 1.5 each. */
    fadeIn?: number;
    fadeOut?: number;
  };
  segments: Segment[];
}

/** Run a child process to completion, rejecting on non-zero exit. */
export function run(cmd: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "ignore", "inherit"], env });
    p.on("error", reject);
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}

/** Probe a media file's duration in seconds. */
export function probeDuration(file: string, env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve, reject) => {
    const p = spawn(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
      { stdio: ["ignore", "pipe", "inherit"], env },
    );
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("error", reject);
    p.on("exit", (code) => {
      const n = Number.parseFloat(out.trim());
      code === 0 && Number.isFinite(n)
        ? resolve(n)
        : reject(new Error(`ffprobe failed for ${file}`));
    });
  });
}

/** Escape a filesystem path for use inside an ffmpeg filtergraph option value. */
export function escPath(p: string): string {
  // Forward slashes parse cleanly everywhere; the Windows drive colon must be
  // escaped so the filtergraph parser doesn't treat it as an option separator.
  return p.replace(/\\/g, "/").replace(/:/g, "\\:");
}

/** Normalize any source frame to the master canvas (scale-to-fit + black pad). */
export function normalizeFilter(cfg: DemoConfig): string {
  const { w, h } = cfg.video.canvas;
  return (
    `scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=lanczos,` +
    `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`
  );
}

interface Built {
  path: string;
  duration: number;
}

/** Render one CLIP segment to a normalized intermediate. */
async function buildClip(
  cfg: DemoConfig,
  seg: ClipSegment,
  out: string,
  tmpDir: string,
  idx: number,
): Promise<Built> {
  const env = cfg.augmentedEnv();
  const font = escPath(cfg.video.fontFile);
  const rate = seg.rate ?? 1;
  const len = seg.out - seg.in;
  if (len <= 0) throw new Error(`clip ${idx}: out must be > in`);
  const dur = len / rate;

  const vf: string[] = [`setpts=PTS/${rate}`, normalizeFilter(cfg), `fps=${cfg.video.fps}`];

  if (seg.caption) {
    const capFile = join(tmpDir, `cap-${idx}.txt`);
    await writeFile(capFile, seg.caption, "utf8");
    // Lower-third pill with a short alpha fade in/out so captions don't pop.
    const fade = `if(lt(t,0.3),t/0.3,if(gt(t,${(dur - 0.3).toFixed(3)}),(${dur.toFixed(3)}-t)/0.3,1))`;
    vf.push(
      `drawtext=fontfile='${font}':textfile='${escPath(capFile)}':` +
        `fontcolor=white:fontsize=46:box=1:boxcolor=black@0.55:boxborderw=26:` +
        `x=(w-text_w)/2:y=h-text_h-110:alpha='${fade}'`,
    );
  }

  await run(
    cfg.tools.ffmpeg,
    [
      "-y",
      "-ss", seg.in.toFixed(3),
      "-i", seg.source,
      "-t", len.toFixed(3),
      "-an",
      "-vf", vf.join(","),
      "-c:v", "libx264", "-preset", "medium", "-crf", String(cfg.video.crf),
      "-pix_fmt", "yuv420p",
      out,
    ],
    env,
  );
  return { path: out, duration: await probeDuration(out, env) };
}

/** Render one CARD segment (solid background + title/subtitle, faded). */
async function buildCard(
  cfg: DemoConfig,
  seg: CardSegment,
  out: string,
  tmpDir: string,
  idx: number,
): Promise<Built> {
  const env = cfg.augmentedEnv();
  const font = escPath(cfg.video.fontFile);
  const { w: W, h: H } = cfg.video.canvas;
  const bg = seg.bg ?? "0x0B1220";
  const dur = seg.duration;
  const titleFile = join(tmpDir, `title-${idx}.txt`);
  await writeFile(titleFile, seg.title, "utf8");

  const draws = [
    `drawtext=fontfile='${font}':textfile='${escPath(titleFile)}':` +
      `fontcolor=white:fontsize=92:x=(w-text_w)/2:y=(h-text_h)/2${seg.subtitle ? "-60" : ""}`,
  ];
  if (seg.subtitle) {
    const subFile = join(tmpDir, `sub-${idx}.txt`);
    await writeFile(subFile, seg.subtitle, "utf8");
    draws.push(
      `drawtext=fontfile='${font}':textfile='${escPath(subFile)}':` +
        `fontcolor=0x9FB3C8:fontsize=44:x=(w-text_w)/2:y=(h-text_h)/2+70`,
    );
  }
  const vf = [
    ...draws,
    `fade=t=in:st=0:d=0.4`,
    `fade=t=out:st=${(dur - 0.4).toFixed(3)}:d=0.4`,
    "setsar=1",
    "format=yuv420p",
  ].join(",");

  await run(
    cfg.tools.ffmpeg,
    [
      "-y",
      "-f", "lavfi",
      "-i", `color=c=${bg}:s=${W}x${H}:d=${dur.toFixed(3)}:r=${cfg.video.fps}`,
      "-vf", vf,
      "-c:v", "libx264", "-preset", "medium", "-crf", String(cfg.video.crf),
      "-pix_fmt", "yuv420p",
      out,
    ],
    env,
  );
  return { path: out, duration: await probeDuration(out, env) };
}

/**
 * Render a Remotion composition to a temp MP4, then normalize it through the
 * SAME clip pipeline (scale-to-fit + pad + fps + optional caption) so it joins
 * seamlessly with screencast clips. Keeps the EDL declarative — the consumer
 * just names an `entry` + `compositionId`.
 */
async function buildRemotion(
  cfg: DemoConfig,
  seg: RemotionSegment,
  out: string,
  tmpDir: string,
  idx: number,
): Promise<Built> {
  const env = cfg.augmentedEnv();
  const raw = join(tmpDir, `remotion-${idx}.mp4`);
  await renderRemotion(cfg, {
    entry: seg.entry,
    compositionId: seg.compositionId,
    props: seg.props,
    outFile: raw,
  });
  const dur = await probeDuration(raw, env);
  // Reuse buildClip by presenting the render as a full-length clip source.
  return buildClip(
    cfg,
    { kind: "clip", source: raw, in: 0, out: dur, caption: seg.caption },
    out,
    tmpDir,
    idx,
  );
}

/** Crossfade-chain (or hard-concat) normalized segments into one video file. */
async function joinSegments(
  cfg: DemoConfig,
  built: Built[],
  transition: number,
  out: string,
): Promise<void> {
  const env = cfg.augmentedEnv();
  const fps = cfg.video.fps;
  if (built.length === 1) {
    await run(cfg.tools.ffmpeg, ["-y", "-i", built[0].path, "-c", "copy", out], env);
    return;
  }

  const inputs = built.flatMap((b) => ["-i", b.path]);

  if (transition <= 0) {
    // Hard cuts via the concat filter (re-encode to guarantee uniform stream).
    const n = built.length;
    const concat = built.map((_, i) => `[${i}:v]`).join("") + `concat=n=${n}:v=1:a=0[v]`;
    await run(
      cfg.tools.ffmpeg,
      [
        "-y", ...inputs,
        "-filter_complex", concat,
        "-map", "[v]",
        "-c:v", "libx264", "-preset", "medium", "-crf", String(cfg.video.crf),
        "-pix_fmt", "yuv420p", "-r", String(fps),
        out,
      ],
      env,
    );
    return;
  }

  // xfade chain. offset_k = (sum of durations before input k) - k*transition.
  const T = transition;
  const parts: string[] = [];
  let prev = "[0:v]";
  let cum = built[0].duration;
  for (let k = 1; k < built.length; k++) {
    const offset = cum - k * T;
    const label = k === built.length - 1 ? "[v]" : `[x${k}]`;
    parts.push(`${prev}[${k}:v]xfade=transition=fade:duration=${T}:offset=${offset.toFixed(3)}${label}`);
    prev = label;
    cum += built[k].duration;
  }

  await run(
    cfg.tools.ffmpeg,
    [
      "-y", ...inputs,
      "-filter_complex", parts.join(";"),
      "-map", "[v]",
      "-c:v", "libx264", "-preset", "medium", "-crf", String(cfg.video.crf),
      "-pix_fmt", "yuv420p", "-r", String(fps),
      out,
    ],
    env,
  );
}

/** Mux a faded, volume-ducked music bed under a finished video. */
export async function addMusic(
  cfg: DemoConfig,
  video: string,
  music: VideoEdl["music"],
  out: string,
): Promise<void> {
  const env = cfg.augmentedEnv();
  if (!music) {
    await run(cfg.tools.ffmpeg, ["-y", "-i", video, "-c", "copy", "-movflags", "+faststart", out], env);
    return;
  }
  const total = await probeDuration(video, env);
  const vol = music.volume ?? 0.6;
  const fin = music.fadeIn ?? 1.5;
  const fout = music.fadeOut ?? 1.5;
  const afilter =
    `[1:a]volume=${vol},` +
    `afade=t=in:st=0:d=${fin},` +
    `afade=t=out:st=${(total - fout).toFixed(3)}:d=${fout}[a]`;

  await run(
    cfg.tools.ffmpeg,
    [
      "-y",
      "-i", video,
      "-stream_loop", "-1", "-i", music.file,
      "-filter_complex", afilter,
      "-map", "0:v", "-map", "[a]",
      "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
      "-shortest", "-movflags", "+faststart",
      out,
    ],
    env,
  );
}

/** Compose an EDL into a finished MP4 under cfg.video.outDir. Returns the path. */
export async function compose(cfg: DemoConfig, edl: VideoEdl): Promise<string> {
  const env = cfg.augmentedEnv();
  await mkdir(cfg.video.outDir, { recursive: true });
  const tmpDir = join(cfg.video.outDir, `.tmp-${edl.id}`);
  await rm(tmpDir, { recursive: true, force: true });
  await mkdir(tmpDir, { recursive: true });

  const transition = edl.transition ?? 0.4;

  try {
    console.log(`• building ${edl.segments.length} segment(s)…`);
    const built: Built[] = [];
    for (let i = 0; i < edl.segments.length; i++) {
      const seg = edl.segments[i];
      const out = join(tmpDir, `seg-${String(i).padStart(2, "0")}.mp4`);
      const b =
        seg.kind === "card"
          ? await buildCard(cfg, seg, out, tmpDir, i)
          : seg.kind === "remotion"
            ? await buildRemotion(cfg, seg, out, tmpDir, i)
            : await buildClip(cfg, seg, out, tmpDir, i);
      if (b.duration <= transition && edl.segments.length > 1) {
        throw new Error(`segment ${i} (${b.duration.toFixed(2)}s) is shorter than the ${transition}s crossfade`);
      }
      console.log(`  seg ${i}: ${b.duration.toFixed(2)}s`);
      built.push(b);
    }

    console.log("• joining segments…");
    const joined = join(tmpDir, "joined.mp4");
    await joinSegments(cfg, built, transition, joined);

    const final = join(cfg.video.outDir, `${edl.id}.mp4`);
    // Score only if a real track is present; otherwise render silent so the
    // pipeline still produces a usable master (drop a track and re-run later).
    const music = edl.music && existsSync(edl.music.file) ? edl.music : undefined;
    if (edl.music && !music) {
      console.log(`• no music at ${edl.music.file} — rendering silent`);
    }
    console.log(music ? "• scoring (music bed)…" : "• finalizing…");
    await addMusic(cfg, joined, music, final);

    const dur = await probeDuration(final, env);
    console.log(`✔ ${edl.id} — ${dur.toFixed(1)}s → ${final}`);
    return final;
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}
