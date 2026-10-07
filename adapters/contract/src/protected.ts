import { homedir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";

/** The denial reason adapters report; "denied" makes `toolDenied` mark the tool call. */
export const PROTECTED_PATH_DENIAL = "Glassys denied access to its own data directory (secrets, sessions)";

function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return homedir() + path.slice(1);
  return path;
}

function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/**
 * Whether `path` (absolute, `~/`, or relative to `cwd`) points into one of `protectedPaths`.
 * Lexical only; callers that touch the disk resolve symlinks first.
 */
export function isProtectedPath(path: string, cwd: string, protectedPaths: readonly string[] | undefined): boolean {
  if (!protectedPaths?.length || !path) return false;
  const abs = resolve(cwd, expandHome(path));
  return protectedPaths.some((root) => inside(resolve(root), abs));
}

/**
 * Best-effort check of a shell command: does it name a protected directory, absolutely, from
 * `~`, or relative to `cwd`? A shell can always reach a path some other way; this catches the
 * plain case, and the sandbox is the real boundary.
 */
export function commandTouchesProtectedPath(command: string, cwd: string, protectedPaths: readonly string[] | undefined): boolean {
  if (!protectedPaths?.length || !command) return false;
  const home = homedir();
  return protectedPaths.some((raw) => {
    const root = resolve(raw);
    const forms = new Set<string>([root]);
    if (inside(home, root) && root !== home) forms.add(`~${sep}${relative(home, root)}`);
    if (inside(resolve(cwd), root) && root !== resolve(cwd)) {
      const rel = relative(resolve(cwd), root);
      forms.add(rel);
      forms.add(`.${sep}${rel}`);
    }
    return [...forms].some((form) => {
      // A bare one-segment name ("data" with the cwd at the Glassys clone) is also an ordinary
      // word (`docker logs data`): count it only as a path, followed by "/".
      const bareWord = !form.includes(sep) && !form.includes("/");
      let at = command.indexOf(form);
      while (at !== -1) {
        const before = at === 0 ? " " : command[at - 1]!;
        const after = command[at + form.length] ?? " ";
        // A whole path: not "mydata" for "data", not "data2".
        const ends = bareWord ? after === "/" || after === sep : /[\s'"/;|&)<>`*]/.test(after);
        if (/[\s'"=:;|&(<>`]/.test(before) && ends) return true;
        at = command.indexOf(form, at + 1);
      }
      return false;
    });
  });
}
