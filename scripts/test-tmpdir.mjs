// Gives each test run its own TMPDIR and removes it afterwards. The suites create hundreds of
// mkdtemp() directories per run and most never clean up, so they piled up in the system temp
// dir (a RAM-backed tmpfs on many Linux hosts). Pointing TMPDIR at a throwaway directory fixes
// every test at once instead of adding cleanup to each of them. os.tmpdir() reads TMPDIR on
// Linux and macOS, the platforms the suites run on.
//
// Two ways in:
// - Vitest `globalSetup`: runs in the main process before the workers start, so they inherit it.
// - CLI wrapper for `node --test`: `node scripts/test-tmpdir.mjs <command> [args...]`.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export default function setup() {
  const previous = process.env.TMPDIR;
  const dir = mkdtempSync(join(tmpdir(), "glassys-test-"));
  process.env.TMPDIR = dir;
  return () => {
    rmSync(dir, { recursive: true, force: true });
    if (previous === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previous;
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, ...args] = process.argv.slice(2);
  if (!command) {
    console.error("usage: node scripts/test-tmpdir.mjs <command> [args...]");
    process.exit(2);
  }
  const teardown = setup();
  const result = spawnSync(command, args, { stdio: "inherit" });
  teardown();
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
