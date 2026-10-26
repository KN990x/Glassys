import { IconAlert, IconCheck, IconError, IconSpinner, IconStop } from "./Icon";

export type ToolStatus = "running" | "done" | "denied" | "error" | "stopped";

/** One glyph per tool state, for the transcript's rows and the Activity panel alike. */
export function ToolStateIcon({ status }: { status: string }) {
  if (status === "running") return <IconSpinner />;
  if (status === "done") return <IconCheck />;
  if (status === "denied") return <IconAlert />;
  if (status === "stopped") return <IconStop />;
  return <IconError />;
}

const LABEL_KEYS: Record<ToolStatus, string> = {
  running: "tool.running",
  done: "tool.done",
  denied: "tool.denied",
  error: "tool.error",
  stopped: "tool.stopped",
};

export function toolStateLabel(status: string, t: (key: string) => string): string {
  return t(LABEL_KEYS[status as ToolStatus] ?? "tool.done");
}
