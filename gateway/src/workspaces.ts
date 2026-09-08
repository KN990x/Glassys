import { readdir, stat } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";
import { HttpError } from "./errors.js";

const MAX_HITS = 50;
const MAX_DEPTH = 2;

export interface WorkspaceHit {
  path: string;
  name: string;
}

async function isGitRepo(dir: string): Promise<boolean> {
  try {
    const s = await stat(join(dir, ".git"));
    return s.isDirectory() || s.isFile();
  } catch {
    return false;
  }
}

async function walk(root: string, depth: number, hits: WorkspaceHit[]): Promise<void> {
  if (hits.length >= MAX_HITS) return;
  if (await isGitRepo(root)) {
    hits.push({ path: root, name: basename(root) });
    return;
  }
  if (depth >= MAX_DEPTH) return;
  let entries: string[] = [];
  try {
    entries = await readdir(root);
  } catch {
    return;
  }
  for (const name of entries) {
    if (hits.length >= MAX_HITS) return;
    if (name.startsWith(".")) continue;
    const next = join(root, name);
    try {
      const s = await stat(next);
      if (!s.isDirectory()) continue;
      await walk(next, depth + 1, hits);
    } catch {
      /* skip */
    }
  }
}

export async function listWorkspaces(root: string): Promise<WorkspaceHit[]> {
  if (!root || !isAbsolute(root)) throw new HttpError(400, "Workspace root must be an absolute path");
  const abs = resolve(root);
  if (abs === "/" || abs === "/Users" || abs === "/home") {
    throw new HttpError(400, "Pick a working directory, not the filesystem root");
  }
  try {
    const s = await stat(abs);
    if (!s.isDirectory()) throw new HttpError(400, "Workspace root is not a directory");
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, "Workspace root does not exist");
  }
  const hits: WorkspaceHit[] = [];
  if (!(await isGitRepo(abs))) {
    hits.push({ path: abs, name: basename(abs) });
  }
  await walk(abs, 0, hits);
  const seen = new Set<string>();
  const unique: WorkspaceHit[] = [];
  for (const hit of hits) {
    if (seen.has(hit.path)) continue;
    seen.add(hit.path);
    unique.push(hit);
  }
  unique.sort((a, b) => a.name.localeCompare(b.name));
  return unique.slice(0, MAX_HITS);
}
