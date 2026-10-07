#!/usr/bin/env node
/**
 * Drive one adapter against a real agent and check what reaches the transcript.
 *
 *   pnpm build:packages
 *   node scripts/smoke-adapter.mjs cursor
 *   node scripts/smoke-adapter.mjs claude --model sonnet
 *   node scripts/smoke-adapter.mjs acp --command npx --args "-y @agentclientprotocol/claude-agent-acp@0.86.0"
 *   GLASSYS_RECORD_FIXTURES=/tmp/fx node scripts/smoke-adapter.mjs codex   # also records raw SDK events
 *
 * Not for CI: it needs the agent's credentials and spends tokens. It runs in a fresh temporary
 * workspace with auto-run on, asks the agent to write a file, edit it, run a failing command and
 * list the folder, and then checks that the events Glassys paints from are all there: text, tool
 * cards with their path or command, a diff for the edit, a failed shell, and a finished run.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXPORTS = {
  cursor: "cursorAdapter",
  claude: "claudeAdapter",
  codex: "codexAdapter",
  opencode: "opencodeAdapter",
  acp: "acpAdapter",
  gemini: "geminiAdapter",
};

function parseArgs(argv) {
  const [id, ...rest] = argv;
  const opts = { id, model: "", command: "", args: [], keep: false, timeoutMs: 300_000 };
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (flag === "--model") opts.model = rest[++i] ?? "";
    else if (flag === "--command") opts.command = rest[++i] ?? "";
    else if (flag === "--args") opts.args = (rest[++i] ?? "").split(" ").filter(Boolean);
    else if (flag === "--keep") opts.keep = true;
    else if (flag === "--timeout") opts.timeoutMs = Number(rest[++i]) * 1000;
  }
  return opts;
}

const PROMPT = [
  "This is an automated check of a tool-calling UI. Do exactly these steps, using your tools:",
  "1. Create a file named smoke.txt in the current directory containing the single line: hello",
  "2. Edit smoke.txt so the line reads: hello world",
  "3. Run the shell command `false` (it is meant to fail; do not try to fix it).",
  "4. List the files in the current directory.",
  "Then reply with one short sentence.",
].join("\n");

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.id || !EXPORTS[opts.id]) {
    console.error(`Usage: node scripts/smoke-adapter.mjs <${Object.keys(EXPORTS).join("|")}> [--model m] [--command c --args "a b"] [--keep]`);
    process.exit(2);
  }
  const mod = await import(pathToFileURL(join(root, "adapters", opts.id, "dist", "index.js")).href);
  const adapter = mod[EXPORTS[opts.id]];
  await adapter.probe?.(opts.id === "acp" ? { command: opts.command, args: opts.args } : undefined);

  const cwd = mkdtempSync(join(tmpdir(), "glassys-smoke-"));
  const options = { autoRun: true, ...(opts.id === "acp" ? { command: opts.command, args: opts.args } : {}) };
  const agent = adapter.normalizeConfig
    ? adapter.normalizeConfig({ adapter: opts.id, cwd, model: opts.model, modelParams: [], options })
    : { model: opts.model, modelParams: [], options };
  const createOpts = {
    cwd,
    model: agent.model || adapter.capabilities.defaultModel?.id || "",
    modelParams: agent.modelParams ?? adapter.capabilities.defaultModel?.params ?? [],
    storeDir: join(cwd, ".glassys-smoke-store"),
    options: agent.options ?? options,
  };
  console.log(`workspace ${cwd}`);
  const events = [];
  const session = await adapter.create(createOpts);
  let status = "timeout";
  try {
    const run = await session.send(PROMPT, (e) => {
      events.push(e);
      if (e.type === "tool.start") console.log(`  tool.start ${e.kind} ${e.command ?? e.path ?? e.title}`);
      if (e.type === "tool.end") console.log(`  tool.end   ${e.kind} ok=${e.ok}${e.diff ? " diff" : ""}${e.error ? ` error=${e.error.slice(0, 60)}` : ""}`);
      if (e.type === "run.error") console.log(`  run.error  ${e.message}`);
    });
    status = await Promise.race([run.wait(), new Promise((r) => setTimeout(() => r("timeout"), opts.timeoutMs))]);
    if (status === "timeout") await run.cancel().catch(() => undefined);
  } finally {
    await session.dispose?.();
    await adapter.shutdown?.();
    if (!opts.keep) rmSync(cwd, { recursive: true, force: true });
  }

  const starts = events.filter((e) => e.type === "tool.start");
  const ends = events.filter((e) => e.type === "tool.end");
  const checks = [
    ["the run finished", status === "finished"],
    ["the reply streamed as text", events.some((e) => e.type === "text.delta" && e.text.trim())],
    ["tool cards name a path or a command", starts.some((e) => e.path || e.command)],
    ["every tool that started also ended", starts.every((s) => ends.some((e) => e.callId === s.callId))],
    ["the edit came with a diff or line counts", ends.some((e) => e.diff || e.stats)],
    ["the failing command ended not ok", ends.some((e) => e.kind === "shell" && !e.ok)],
  ];
  console.log("");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const usage = events.find((e) => e.type === "run.usage");
  if (usage) console.log(`      usage in=${usage.inputTokens ?? "?"} out=${usage.outputTokens ?? "?"}`);
  process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
