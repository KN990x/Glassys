import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readGitContext, safeGitEnv } from "./host-git.js";

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
    execFileSync("git", ["checkout", "a.txt"], { cwd: dir, stdio: "ignore" });
    await writeFile(join(dir, "new.txt"), "untracked\n", "utf8");
    expect(await readGitContext(dir)).toEqual({ branch: clean!.branch, dirty: true });
  });

  it("does not run a clean filter the repo's own config and attributes name", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glassys-gitfilter-"));
    execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
    const id = ["-c", "user.email=ops@example.test", "-c", "user.name=Ops", "-c", "commit.gpgsign=false"];
    await writeFile(join(dir, "a.txt"), "x\n", "utf8");
    execFileSync("git", ["add", "a.txt"], { cwd: dir, stdio: "ignore" });
    execFileSync("git", [...id, "commit", "-m", "init"], { cwd: dir, stdio: "ignore" });
    const marker = join(dir, "ran");
    await writeFile(join(dir, ".gitattributes"), "* filter=evil\n", "utf8");
    execFileSync("git", ["config", "filter.evil.clean", `sh -c 'touch ${marker}; cat'`], { cwd: dir, stdio: "ignore" });
    /* A stat change makes status re-hash the file through the filter. */
    await utimes(join(dir, "a.txt"), new Date(2020, 0, 1), new Date(2020, 0, 1));
    await readGitContext(dir);
    expect(existsSync(marker)).toBe(false);
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

  it("builds the git environment after the secrets are sealed, not at import", () => {
    process.env.GLASSYS_TEST_SEALED = "secret";
    try {
      expect(safeGitEnv().GLASSYS_TEST_SEALED).toBe("secret");
      delete process.env.GLASSYS_TEST_SEALED;
      expect(safeGitEnv().GLASSYS_TEST_SEALED).toBeUndefined();
    } finally {
      delete process.env.GLASSYS_TEST_SEALED;
    }
  });
});
