import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, readFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { spawn, spawnSync } from "node:child_process";
import { PROTOCOL_VERSION } from "@glassys/protocol";
import { writeFileAtomic } from "./atomic.js";
import { GATEWAY_VERSION, repoRoot, runningBuild } from "./build-info.js";
import { paths, log } from "./paths.js";
import { HttpError } from "./errors.js";

const SERVICE_LABEL = "dev.kn990x.glassys";
const SYSTEMD_UNIT = "glassys.service";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 10_000;

export type ServiceKind = "launchd" | "systemd" | "none";
export type UpgradePhase = "idle" | "starting" | "pulling" | "install" | "build" | "restart" | "error";

let detectOverride: ServiceKind | null = null;
let gitInfoOverride: { sha: string; branch: string; dirty: boolean } | null | undefined;

export function setDetectServiceForTests(kind: ServiceKind | null): void {
  detectOverride = kind;
}

export function setInstallGitForTests(info: { sha: string; branch: string; dirty: boolean } | null | undefined): void {
  gitInfoOverride = info;
}

export interface UpgradeStatus {
  phase: UpgradePhase;
  error?: string;
  /** Set once per upgrade run; every later phase keeps it. */
  startedAt?: string;
  updatedAt?: string;
  fromSha?: string;
  /** The commit the restarted gateway must report. */
  targetSha?: string;
}

export function detectService(env = process.env, platform = process.platform): ServiceKind {
  if (detectOverride) return detectOverride;
  if (env.GLASSYS_SERVICE === "1") {
    if (platform === "darwin") return "launchd";
    if (platform === "linux") return "systemd";
  }
  if (platform === "darwin") {
    const printed = spawnSync("launchctl", ["print", `gui/${process.getuid?.() ?? 0}/${SERVICE_LABEL}`], {
      encoding: "utf8",
      timeout: 2000,
    });
    if (printed.status === 0) return "launchd";
  }
  if (platform === "linux") {
    const cat = spawnSync("systemctl", ["--user", "cat", SYSTEMD_UNIT], { encoding: "utf8", timeout: 2000 });
    if (cat.status === 0) return "systemd";
  }
  return "none";
}

async function git(args: string[], timeout = GIT_TIMEOUT_MS): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", repoRoot(), ...args], {
    timeout,
    windowsHide: true,
  });
  return stdout.trim();
}

export async function readInstallGit(): Promise<{ sha: string; branch: string; dirty: boolean } | undefined> {
  if (gitInfoOverride !== undefined) return gitInfoOverride ?? undefined;
  if (!existsSync(join(repoRoot(), ".git"))) return undefined;
  try {
    const sha = await git(["rev-parse", "HEAD"]);
    const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"]);
    const dirty = (await git(["status", "--porcelain"])).length > 0;
    return { sha, branch, dirty };
  } catch {
    return undefined;
  }
}

export async function fetchBehind(): Promise<{ behind: number; sha: string; branch: string; dirty: boolean }> {
  const gitInfo = await readInstallGit();
  if (!gitInfo) throw new HttpError(400, "This install is not a git clone");
  try {
    await git(["fetch", "--quiet"], GIT_TIMEOUT_MS);
  } catch (err) {
    /* git's stderr can name the remote URL with credentials in it; keep it in the log. */
    log("warn", "git fetch failed", { error: String(err) });
    throw new HttpError(400, "git fetch failed");
  }
  let behind = 0;
  try {
    const n = await git(["rev-list", "--count", "HEAD..@{u}"]);
    behind = Number.parseInt(n, 10) || 0;
  } catch {
    behind = 0;
  }
  const latest = await readInstallGit();
  return { behind, sha: latest?.sha || gitInfo.sha, branch: latest?.branch || gitInfo.branch, dirty: latest?.dirty ?? gitInfo.dirty };
}

export async function readUpgradeStatus(): Promise<UpgradeStatus> {
  try {
    return JSON.parse(await readFile(paths.upgradeStatus(), "utf8")) as UpgradeStatus;
  } catch {
    return { phase: "idle" };
  }
}

export async function writeUpgradeStatus(status: UpgradeStatus): Promise<void> {
  await mkdir(dirname(paths.upgradeStatus()), { recursive: true, mode: 0o700 });
  /* Temp file + rename: a file left 0664 by an older upgrade script is replaced, not kept. */
  await writeFileAtomic(paths.upgradeStatus(), JSON.stringify({ ...status, updatedAt: new Date().toISOString() }, null, 2));
}

/**
 * On systemd the upgrade script lives in the unit's cgroup, so the restart it asks for also
 * kills it before it can report the outcome. The new process closes the run instead: it is
 * the proof the restart happened, and its commit says whether it is the code that was built.
 */
export async function reconcileUpgradeStatus(): Promise<void> {
  const cur = await readUpgradeStatus();
  if (cur.phase !== "restart") return;
  const { commit } = runningBuild();
  if (cur.targetSha && commit && cur.targetSha !== commit) {
    const error = `Restarted on ${commit.slice(0, 7)}, expected ${cur.targetSha.slice(0, 7)}`;
    log("warn", "upgrade restart came back on another commit", { expected: cur.targetSha, running: commit });
    await writeUpgradeStatus({ ...cur, phase: "error", error });
    return;
  }
  log("info", "upgrade finished", { commit });
  await writeUpgradeStatus({ ...cur, phase: "idle", error: undefined });
}

export async function adminUpdateSnapshot(): Promise<{
  version: string;
  protocolVersion: number;
  git?: { sha: string; branch: string; dirty: boolean };
  running: { commit?: string; startedAt: string };
  service: ServiceKind;
  upgrading?: UpgradeStatus;
}> {
  const gitInfo = await readInstallGit();
  const upgrading = await readUpgradeStatus();
  return {
    version: GATEWAY_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    ...(gitInfo ? { git: gitInfo } : {}),
    running: runningBuild(),
    service: detectService(),
    ...(upgrading.phase !== "idle" ? { upgrading } : {}),
  };
}

let spawnUpgrade = spawn;

export function setUpgradeSpawnForTests(fn: typeof spawn | null): void {
  spawnUpgrade = fn ?? spawn;
}

export async function startUpgrade(): Promise<void> {
  const service = detectService();
  if (service === "none") {
    throw new HttpError(409, "Upgrade from the PWA needs the user service (pnpm run service:install). Use pnpm run service:upgrade in the clone.");
  }
  const gitInfo = await readInstallGit();
  if (gitInfo?.dirty) {
    throw new HttpError(409, "Working tree is dirty");
  }
  const cur = await readUpgradeStatus();
  if (cur.phase !== "idle" && cur.phase !== "error") {
    throw new HttpError(409, "An upgrade is already running");
  }
  const startedAt = new Date().toISOString();
  await writeUpgradeStatus({ phase: "starting", startedAt, ...(gitInfo ? { fromSha: gitInfo.sha } : {}) });
  const script = join(repoRoot(), "scripts", "host-service.mjs");
  const logPath = paths.upgradeLog();
  await mkdir(dirname(logPath), { recursive: true, mode: 0o700 });
  const fs = await import("node:fs");
  const out = fs.openSync(logPath, "a", 0o600);
  /* The mode above only applies on create; a log left by an older build is tightened here. */
  await chmod(logPath, 0o600).catch(() => undefined);
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawnUpgrade(process.execPath, [script, "upgrade"], {
        cwd: repoRoot(),
        detached: true,
        stdio: ["ignore", out, out],
        env: { ...process.env, GLASSYS_UPGRADE_STRICT: "1", GLASSYS_UPGRADE_STARTED_AT: startedAt },
      });
      const fail = (err: Error) => {
        try {
          fs.closeSync(out);
        } catch {
          /* already closed */
        }
        reject(err);
      };
      child.once("error", fail);
      child.once("spawn", () => {
        child.removeListener("error", fail);
        try {
          fs.closeSync(out);
        } catch {
          /* already closed */
        }
        child.unref();
        resolve();
      });
    });
    log("info", "upgrade spawned");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await writeUpgradeStatus({ phase: "error", error: message, startedAt });
    throw new HttpError(500, message);
  }
}
