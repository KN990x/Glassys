/** Context lines around each change, as `diff -u` prints them. */
const CONTEXT = 3;
/** Above this many old×new lines the middle is shown as one replacement instead of diffed. */
const MAX_LCS_CELLS = 4_000_000;

type Op = { kind: " " | "-" | "+"; text: string };

function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Line operations turning `a` into `b`: common prefix and suffix, then an LCS over the rest. */
function lineOps(a: string[], b: string[]): Op[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const ops: Op[] = a.slice(0, start).map((text) => ({ kind: " ", text }));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  if (midA.length * midB.length > MAX_LCS_CELLS) {
    for (const text of midA) ops.push({ kind: "-", text });
    for (const text of midB) ops.push({ kind: "+", text });
  } else {
    const n = midA.length;
    const m = midB.length;
    const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i]![j] = midA[i] === midB[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        ops.push({ kind: " ", text: midA[i]! });
        i++;
        j++;
      } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
        ops.push({ kind: "-", text: midA[i++]! });
      } else {
        ops.push({ kind: "+", text: midB[j++]! });
      }
    }
    while (i < n) ops.push({ kind: "-", text: midA[i++]! });
    while (j < m) ops.push({ kind: "+", text: midB[j++]! });
  }
  for (const text of a.slice(endA)) ops.push({ kind: " ", text });
  return ops;
}

/** `--- a/x` / `+++ b/x` header; an absolute path keeps one slash after the prefix, not two. */
export function diffHeader(path: string, created = false): string {
  const file = (path || "file").replace(/^\/+/, "");
  return `${created ? "--- /dev/null" : `--- a/${file}`}\n+++ b/${file}`;
}

/**
 * A unified diff from whole old and new file text. `oldText` null or undefined is a new file.
 * Unchanged regions collapse to `CONTEXT` lines around each hunk.
 */
export function unifiedDiff(path: string, oldText: string | null | undefined, newText: string): string {
  const created = oldText == null;
  const ops = lineOps(splitLines(oldText ?? ""), splitLines(newText));
  const header = diffHeader(path, created);
  const changed = ops.map((op, i) => (op.kind === " " ? -1 : i)).filter((i) => i >= 0);
  if (!changed.length) return header;

  const hunks: string[] = [];
  let idx = 0;
  while (idx < changed.length) {
    const from = Math.max(0, changed[idx]! - CONTEXT);
    let to = Math.min(ops.length - 1, changed[idx]! + CONTEXT);
    while (idx + 1 < changed.length && changed[idx + 1]! - CONTEXT <= to + 1) {
      idx++;
      to = Math.min(ops.length - 1, changed[idx]! + CONTEXT);
    }
    idx++;
    let oldStart = 1;
    let newStart = 1;
    for (const op of ops.slice(0, from)) {
      if (op.kind !== "+") oldStart++;
      if (op.kind !== "-") newStart++;
    }
    const body = ops.slice(from, to + 1);
    const oldCount = body.filter((op) => op.kind !== "+").length;
    const newCount = body.filter((op) => op.kind !== "-").length;
    const range = (start: number, count: number) => `${count === 0 ? start - 1 : start},${count}`;
    hunks.push(
      `@@ -${range(oldStart, oldCount)} +${range(newStart, newCount)} @@\n${body.map((op) => op.kind + op.text).join("\n")}`,
    );
  }
  return `${header}\n${hunks.join("\n")}`;
}

/** Added and removed lines of a unified diff, ignoring file headers but not content that looks like them. */
export function diffStats(diff: string): { add: number; del: number } {
  let add = 0;
  let del = 0;
  let inHunk = false;
  for (const line of diff.split("\n")) {
    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }
    if (line.startsWith("diff --git ")) {
      inHunk = false;
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith("+")) add += 1;
    else if (line.startsWith("-")) del += 1;
  }
  return { add, del };
}
