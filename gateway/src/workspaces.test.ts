import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { listWorkspaces } from "./workspaces.js";

describe("listWorkspaces", () => {
  it("rejects non-absolute and filesystem-root scans", async () => {
    await expect(listWorkspaces("relative")).rejects.toThrow(/absolute/);
    await expect(listWorkspaces("/")).rejects.toThrow(/working directory/);
  });

  it("narrows /Users and /home to the operator home", async () => {
    const home = homedir();
    const hitsUsers = await listWorkspaces("/Users");
    const hitsHome = await listWorkspaces("/home");
    expect(hitsUsers).toEqual([{ path: home, name: basename(home) }]);
    expect(hitsHome).toEqual([{ path: home, name: basename(home) }]);
  });

  it("finds git repos two levels down", async () => {
    const root = await mkdtemp(join(tmpdir(), "glassys-ws-"));
    const repo = join(root, "src", "app");
    await mkdir(join(repo, ".git"), { recursive: true });
    await writeFile(join(repo, ".git", "HEAD"), "ref: refs/heads/main");
    const hits = await listWorkspaces(root);
    expect(hits.some((h) => h.path === root)).toBe(true);
    expect(hits.some((h) => h.path === repo && h.name === "app")).toBe(true);
  });

  it("lists immediate subdirectories even when they are not git repos", async () => {
    const root = await mkdtemp(join(tmpdir(), "glassys-ws-"));
    const stack = join(root, "stack");
    await mkdir(stack);
    const hits = await listWorkspaces(root);
    expect(hits.some((h) => h.path === root)).toBe(true);
    expect(hits.some((h) => h.path === stack && h.name === "stack")).toBe(true);
  });
});
