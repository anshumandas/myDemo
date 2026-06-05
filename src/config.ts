/**
 * Configuration: the single injection point that replaces a per-app config
 * singleton. A consuming app calls {@link defineConfig} from its own
 * `demo.config.ts` (which knows its own paths via import.meta.url) and passes
 * the resolved object into every engine function.
 *
 * Everything app-specific lives here: window geometry, app identity, where the
 * built binary + sample data + output land, external tool paths, and the
 * frontend build flag that puts the app into demo mode.
 */
import { join, isAbsolute } from "node:path";
import { homedir, platform } from "node:os";

/** App identity (from the consumer's tauri.conf.json / Cargo.toml). */
export interface AppIdentity {
  /** OS window title — used by ffmpeg gdigrab `title=` capture + window focus. */
  windowTitle: string;
  /** Tauri bundle identifier — names the per-user app-data directory. */
  identifier: string;
  /** cargo package name → debug binary file name. */
  binName: string;
}

/** Capture / encode tuning. */
export interface CaptureConfig {
  /** MP4 capture frame rate. */
  fps: number;
  /** GIF output frame rate (downsampled from the MP4 for smaller files). */
  gifFps: number;
  /** Fixed GIF canvas (every GIF is scaled-to-fit + black-padded to this). */
  gifCanvas: { w: number; h: number };
}

/** Post-production (video edit) tuning. */
export interface VideoConfig {
  /** Master render canvas. Source clips are scaled-to-fit + padded. */
  canvas: { w: number; h: number };
  /** Output frame rate of finished videos. */
  fps: number;
  /** x264 quality for the master (lower = better; 18 ≈ visually lossless). */
  crf: number;
  /** Absolute path to a .ttf/.otf used for captions and title cards. */
  fontFile: string;
  /** Where finished videos land (separate from the raw per-scenario output). */
  outDir: string;
  /** Background-music folder (royalty-free tracks live here). */
  musicDir: string;
}

/** External tool resolution (PATH names or vendored absolute paths). */
export interface ToolsConfig {
  /** WebDriver bridge for Tauri (cargo install tauri-driver). */
  tauriDriver: string;
  /** Native WebView2 driver, matched to the installed Edge version. */
  edgeDriver: string;
  /** ChromeDriver, matched to the installed Chrome (browser driver, name:"chrome"). */
  chromeDriver: string;
  ffmpeg: string;
  gifski: string;
}

/** Which engine drives + records the UI. Defaults to "tauri" for backward compat. */
export type DriverKind = "tauri" | "browser";

/** Supported real browsers for the `browser` driver. */
export type BrowserName = "edge" | "chrome";

/** How `h.goto("/route")` resolves for the browser driver. */
export type RoutingMode = "hash" | "path";

/**
 * Optional web-server lifecycle for the browser driver — the analogue of the
 * Tauri path's `vite preview` (server.ts). The engine spawns `command`, waits
 * for the readiness signal, records, then tears it down. Omit the whole block
 * (or pass `skipStartup` at the call site) when the app is already running.
 */
export interface WebServerConfigInput {
  /**
   * Start command. A string is run through the shell (`npm run dev`);
   * an argv array is spawned directly (`["npm","run","dev"]`).
   */
  command: string | string[];
  /** Working directory for the command. Default: rootDir. */
  cwd?: string;
  /** Extra env merged over augmentedEnv() for the server process. */
  env?: Record<string, string>;
  /**
   * Readiness signal — an HTTP(S) URL polled until it answers. If omitted, the
   * engine falls back to a TCP probe of the browser `url`'s port, and finally to
   * the in-page `navAnchor` wait once the page is navigated.
   */
  readyUrl?: string;
  /** Documentation-only alias: the navAnchor test-id that proves readiness in-page. */
  readyTestId?: string;
  /** How long to wait for readiness before failing. Default 120000. */
  startupTimeoutMs?: number;
}

/** Browser-driver specific configuration (used only when driver === "browser"). */
export interface BrowserConfigInput {
  /** Which browser to drive (headed). Default "edge" (this repo vendors msedgedriver). */
  name?: BrowserName;
  /** Base web URL the app serves at, e.g. "http://localhost:3000". */
  url: string;
  /**
   * Route mode for `h.goto("/route")`. "path" resolves against `url`
   * (Next.js App Router); "hash" appends `#/route` (SPA hash routers).
   * Default "path".
   */
  routing?: RoutingMode;
  /**
   * Logical window size. When set, the browser launches at this size and the
   * window is measured as-is (chrome-free via app mode); when omitted the window
   * is maximized like the Tauri path.
   */
  viewport?: { width: number; height: number };
  /**
   * Launch in app/kiosk mode (Edge/Chrome `--app=<url>`) so the captured frame
   * is chrome-free (no tabs/address bar). Default true.
   */
  appMode?: boolean;
  /** Optional web-server lifecycle (see {@link WebServerConfigInput}). */
  webServer?: WebServerConfigInput;
}

/** What a consuming app passes to {@link defineConfig}. */
export interface DemoConfigInput {
  /** Absolute path to the app repo root (where src-tauri/, dist/ live). */
  rootDir: string;
  /** Absolute path to the app's demo/ folder (where output/, fixtures/, .bin/ live). */
  demoDir: string;
  /**
   * Which driver records the UI. "tauri" (default) drives the built native
   * binary; "browser" drives a real headed Edge/Chrome window over a web URL.
   */
  driver?: DriverKind;
  /**
   * App identity. Required for the Tauri driver (window title, app-data dir,
   * binary name). For the browser driver only `windowTitle` is meaningful (the
   * page title used for capture); if omitted it is read live from `document.title`.
   */
  app?: Partial<AppIdentity>;
  /** Browser-driver configuration. Required when `driver === "browser"`. */
  browser?: BrowserConfigInput;
  /**
   * URL the built debug binary loads its UI from (vite preview serves dist/ here).
   * Required for the Tauri driver; ignored by the browser driver (use `browser.url`).
   */
  devUrl?: string;
  /** Selector id to wait for after launch, proving the UI booted (e.g. "nav-dashboard"). */
  navAnchor: string;

  /** Master password the rig types where a vault/lock screen appears. Informational. */
  masterPassword?: string;
  /** Identically-framed logical window the app is asked to present. Informational. */
  window?: { width: number; height: number };
  /** WebDriver bridge port (tauri-driver default 4444). */
  driverPort?: number;
  /** Args passed to the app binary via tauri:options (e.g. ["--demo"]). */
  driverArgs?: string[];

  /**
   * Build configuration. `frontendEnv` is injected into the frontend build so
   * the app constant-folds into demo mode (auto-unlock, skip native dialogs).
   * `VITE_DEMO_OUTPUT_DIR` is added automatically (= dirs.output, forward-slashed).
   */
  build?: {
    frontendEnv?: Record<string, string>;
    /** Frontend build command + args, run from rootDir. Default: vite build. */
    frontend?: { cmd: "vite"; args?: string[] };
    /** Native build command + args, run from <rootDir>/<tauriDir>. Default: cargo build. */
    native?: { cmd: string; args: string[] };
  };

  /**
   * Files to delete from the app-data dir before each recording (fresh state).
   * Defaults to `[]` — typical for the browser driver, where state is owned by
   * the web server, not a local app-data dir.
   */
  resetFiles?: string[];

  /** Path overrides (all relative to rootDir/demoDir unless absolute). */
  paths?: {
    /** Contains Cargo.toml; the debug binary is at <tauriDir>/target/debug. Default "src-tauri". */
    tauriDir?: string;
    /** Vite build output served by `vite preview`. Default "dist" (under rootDir). */
    frontendDist?: string;
    /** Where .mp4/.gif land. Default <demoDir>/output. */
    output?: string;
    /** App-specific test fixtures. Default <demoDir>/fixtures. */
    fixtures?: string;
    /** Vendored binaries (msedgedriver). Default <demoDir>/.bin. */
    bin?: string;
    /** Sample data root (workbooks etc.). Default <rootDir>/sample-data. */
    sampleData?: string;
  };

  /** Capture/encode overrides. */
  capture?: Partial<CaptureConfig>;
  /** Video-edit overrides. */
  video?: Partial<VideoConfig>;
  /** Tool path overrides. */
  tools?: Partial<ToolsConfig>;
}

/** Directories the engine reads/writes. */
export interface Dirs {
  demo: string;
  sampleData: string;
  output: string;
  fixtures: string;
  bin: string;
  dist: string;
}

/** Resolved web-server lifecycle (see {@link WebServerConfigInput}). */
export interface ResolvedWebServer {
  command: string | string[];
  cwd: string;
  env: Record<string, string>;
  readyUrl?: string;
  readyTestId?: string;
  startupTimeoutMs: number;
}

/** Resolved browser-driver configuration. */
export interface ResolvedBrowserConfig {
  name: BrowserName;
  /** Base web URL, trailing slash trimmed. */
  url: string;
  routing: RoutingMode;
  viewport?: { width: number; height: number };
  appMode: boolean;
  webServer?: ResolvedWebServer;
}

/** Fully-resolved configuration handed to every engine function. */
export interface DemoConfig {
  rootDir: string;
  demoDir: string;
  /** Which driver records the UI. */
  driver: DriverKind;
  app: AppIdentity;
  /** Browser-driver configuration (present iff driver === "browser"). */
  browser?: ResolvedBrowserConfig;
  /** The built debug binary tauri-driver launches (Tauri driver). */
  appBinary: string;
  devUrl: string;
  navAnchor: string;
  masterPassword: string;
  window: { width: number; height: number };
  driverPort: number;
  driverArgs: string[];
  tauriDir: string;
  dirs: Dirs;
  tools: ToolsConfig;
  capture: CaptureConfig;
  video: VideoConfig;
  build: {
    frontendEnv: Record<string, string>;
    frontend: { cmd: "vite"; args: string[] };
    native: { cmd: string; args: string[] };
  };
  resetFiles: string[];

  /**
   * Per-user app-data dir where SQLite + the Stronghold vault live.
   * Windows: %APPDATA%\<identifier>; macOS/Linux fall back to sensible defaults.
   */
  appDataDir(): string;
  /**
   * process.env with tool dirs guaranteed on PATH. ffmpeg (winget shim dir) and
   * gifski/tauri-driver (cargo bin) may be absent from a shell whose PATH was
   * captured before install — every child process the rig spawns uses this.
   */
  augmentedEnv(extra?: Record<string, string>): NodeJS.ProcessEnv;
}

const isWin = platform() === "win32";

/** Resolve a possibly-relative path against a base. */
function abs(base: string, p: string | undefined, fallback: string): string {
  if (!p) return fallback;
  return isAbsolute(p) ? p : join(base, p);
}

function defaultFontFile(): string {
  return isWin
    ? join(process.env.WINDIR ?? "C:\\Windows", "Fonts", "segoeuib.ttf")
    : "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
}

/**
 * Resolve user config into the full {@link DemoConfig} the engine consumes.
 * Pure: no I/O, no side effects — just path math + defaults.
 */
export function defineConfig(input: DemoConfigInput): DemoConfig {
  const { rootDir, demoDir } = input;
  const driver: DriverKind = input.driver ?? "tauri";

  // Per-driver validation. Pure (shape checks only) — no I/O. Throw early with a
  // clear message rather than fail deep inside the engine at record time.
  if (driver === "tauri") {
    const missing = (["windowTitle", "identifier", "binName"] as const).filter(
      (k) => !input.app?.[k],
    );
    if (missing.length) {
      throw new Error(
        `defineConfig: driver "tauri" requires app.{${missing.join(", ")}}. ` +
          `Set them, or use driver: "browser" for a web app.`,
      );
    }
    if (!input.devUrl) {
      throw new Error(`defineConfig: driver "tauri" requires devUrl (the URL the debug binary loads).`);
    }
    if (input.browser) {
      throw new Error(`defineConfig: \`browser\` is only valid with driver: "browser" (got driver: "tauri").`);
    }
  } else {
    if (!input.browser?.url) {
      throw new Error(`defineConfig: driver "browser" requires browser.url (the app's base web URL).`);
    }
  }

  const browser: ResolvedBrowserConfig | undefined =
    driver === "browser" && input.browser
      ? {
          name: input.browser.name ?? "edge",
          url: input.browser.url.replace(/\/+$/, ""),
          routing: input.browser.routing ?? "path",
          viewport: input.browser.viewport,
          appMode: input.browser.appMode ?? true,
          webServer: input.browser.webServer
            ? {
                command: input.browser.webServer.command,
                cwd: abs(rootDir, input.browser.webServer.cwd, rootDir),
                env: input.browser.webServer.env ?? {},
                readyUrl: input.browser.webServer.readyUrl,
                readyTestId: input.browser.webServer.readyTestId,
                startupTimeoutMs: input.browser.webServer.startupTimeoutMs ?? 120_000,
              }
            : undefined,
        }
      : undefined;

  // App identity always present in the resolved config. For the browser driver
  // identifier/binName are unused; windowTitle is optional (read live if blank).
  const app: AppIdentity = {
    windowTitle: input.app?.windowTitle ?? "",
    identifier: input.app?.identifier ?? "",
    binName: input.app?.binName ?? "",
  };

  const dirs: Dirs = {
    demo: demoDir,
    sampleData: abs(rootDir, input.paths?.sampleData, join(rootDir, "sample-data")),
    output: abs(demoDir, input.paths?.output, join(demoDir, "output")),
    fixtures: abs(demoDir, input.paths?.fixtures, join(demoDir, "fixtures")),
    bin: abs(demoDir, input.paths?.bin, join(demoDir, ".bin")),
    dist: abs(rootDir, input.paths?.frontendDist, join(rootDir, "dist")),
  };

  const tauriDir = abs(rootDir, input.paths?.tauriDir, join(rootDir, "src-tauri"));
  const appBinary = app.binName
    ? join(tauriDir, "target", "debug", isWin ? `${app.binName}.exe` : app.binName)
    : "";

  const tools: ToolsConfig = {
    tauriDriver: input.tools?.tauriDriver ?? "tauri-driver",
    edgeDriver:
      input.tools?.edgeDriver ?? join(dirs.bin, isWin ? "msedgedriver.exe" : "msedgedriver"),
    chromeDriver:
      input.tools?.chromeDriver ?? join(dirs.bin, isWin ? "chromedriver.exe" : "chromedriver"),
    ffmpeg: input.tools?.ffmpeg ?? "ffmpeg",
    gifski: input.tools?.gifski ?? "gifski",
  };

  const capture: CaptureConfig = {
    fps: input.capture?.fps ?? 30,
    gifFps: input.capture?.gifFps ?? 15,
    gifCanvas: input.capture?.gifCanvas ?? { w: 1024, h: 640 },
  };

  const video: VideoConfig = {
    canvas: input.video?.canvas ?? { w: 1920, h: 1080 },
    fps: input.video?.fps ?? 30,
    crf: input.video?.crf ?? 18,
    fontFile: input.video?.fontFile ?? defaultFontFile(),
    outDir: abs(demoDir, input.video?.outDir, join(dirs.output, "video")),
    musicDir: abs(demoDir, input.video?.musicDir, join(demoDir, "assets", "music")),
  };

  const tauriPlatform = isWin ? "windows" : platform() === "darwin" ? "macos" : "linux";

  return {
    rootDir,
    demoDir,
    driver,
    app,
    browser,
    appBinary,
    devUrl: input.devUrl ?? "",
    navAnchor: input.navAnchor,
    masterPassword: input.masterPassword ?? "",
    window: input.window ?? { width: 1440, height: 900 },
    driverPort: input.driverPort ?? 4444,
    driverArgs: input.driverArgs ?? ["--demo"],
    tauriDir,
    dirs,
    tools,
    capture,
    video,
    build: {
      // VITE_DEMO_OUTPUT_DIR + TAURI_ENV_PLATFORM are injected here so the
      // consumer only declares its own flag (e.g. VITE_DEMO_MODE=1).
      frontendEnv: {
        ...input.build?.frontendEnv,
        VITE_DEMO_OUTPUT_DIR: dirs.output.replace(/\\/g, "/"),
        TAURI_ENV_PLATFORM: tauriPlatform,
      },
      frontend: { cmd: "vite", args: input.build?.frontend?.args ?? ["build"] },
      native: input.build?.native ?? { cmd: "cargo", args: ["build"] },
    },
    resetFiles: input.resetFiles ?? [],

    appDataDir(): string {
      const id = app.identifier;
      if (isWin) {
        const appData = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
        return join(appData, id);
      }
      if (platform() === "darwin") {
        return join(homedir(), "Library", "Application Support", id);
      }
      return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), id);
    },

    augmentedEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
      const sep = isWin ? ";" : ":";
      const extraDirs = isWin
        ? [
            join(
              process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
              "Microsoft",
              "WinGet",
              "Links",
            ),
            join(homedir(), ".cargo", "bin"),
          ]
        : [join(homedir(), ".cargo", "bin"), "/usr/local/bin", "/opt/homebrew/bin"];
      const path = [...extraDirs, process.env.PATH ?? ""].join(sep);
      return { ...process.env, ...extra, PATH: path, Path: path };
    },
  };
}
