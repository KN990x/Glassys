import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readGitContext } from "./host-git.js";

describe("readGitContext", () => {
  it("returns undefined for a non-git directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glassys-nogit-"));
    expect(await readGitContext(dir)).toBeUndefined();
  });

  it("reports branch and dirty state for a git repo", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glassys-git-"));
    execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "ops@example.test"], { cwd: dir, stdio: "ignore" });
    execFileSync("git", ["config", "user.name", "Ops"], { cwd: dir, stdio: "ignore" });
    await writeFile(join(dir, "a.txt"), "ok\n", "utf8");
    execFileSync("git", ["add", "a.txt"], { cwd: dir, stdio: "ignore" });
    execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "init"], { cwd: dir, stdio: "ignore" });
    const clean = await readGitContext(dir);
    expect(clean?.dirty).toBe(false);
    expect(clean?.branch).toBeTruthy();
    await writeFile(join(dir, "a.txt"), "dirty\n", "utf8");
    expect(await readGitContext(dir)).toEqual({ branch: clean!.branch, dirty: true });
  });

  it("does not run the repo's core.fsmonitor program", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glassys-gitfsm-"));
    execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
    const marker = join(dir, "ran");
    const hook = join(dir, "fsmonitor.sh");
    await writeFile(hook, `#!/bin/sh\ntouch ${JSON.stringify(marker)}\n`, { mode: 0o755 });
    await writeFile(join(dir, "a.txt"), "x\n", "utf8");
    execFileSync("git", ["add", "a.txt"], { cwd: dir, stdio: "ignore" });
    const id = ["-c", "user.email=ops@example.test", "-c", "user.name=Ops", "-c", "commit.gpgsign=false"];
    execFileSync("git", [...id, "commit", "-m", "init"], { cwd: dir, stdio: "ignore" });
    /* Set after the commit: git runs the program on any status once the index exists. */
    execFileSync("git", ["config", "core.fsmonitor", hook], { cwd: dir, stdio: "ignore" });
    await readGitContext(dir);
    expect(existsSync(marker)).toBe(false);
  });
});
