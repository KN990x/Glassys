const MESSAGE_KEYS: Record<string, string> = {
  busy: "threads.busy",
  unauthorized: "error.unauthorized",
  "invalid json": "error.invalidJson",
  "unknown message": "error.unknownMessage",
  "title required": "error.titleRequired",
  "payload too large": "error.payloadTooLarge",
  "ACP adapter needs agent.options.command (or a registry pick)": "wizard.acp.commandRequired",
  "Onboarding is not complete": "error.onboarding",
  "Attachments could not be read": "error.attachments",
  "Thread not found": "error.threadNotFound",
  "Workspace path is required": "error.cwdRequired",
  "Workspace path must be absolute": "error.cwdAbsolute",
  "Workspace path is not a directory": "error.cwdNotDir",
  "Workspace path does not exist": "error.cwdMissing",
  "Workspace path is inside the Glassys data directory": "error.cwdDataDir",
  "Only jpeg, png, webp, gif, and text/log uploads are allowed": "error.uploadMime",
  "Queue is full": "error.queueFull",
  "invalid thread id": "error.invalidThreadId",
  "Too many attachments": "error.tooManyAttachments",
  "Gateway is busy, try again": "error.gatewayBusy",
  "Schedule needs either cron or at": "error.scheduleXor",
  "Too many schedules": "error.tooManySchedules",
  "Schedule not found": "error.scheduleNotFound",
  "Schedule text required": "error.scheduleText",
  "Invalid cron expression": "error.invalidCron",
  "This install is not a git clone": "error.notGitClone",
  "An upgrade is already running": "error.upgradeRunning",
  "Working tree is dirty": "error.upgradeDirty",
  "invalid subscription": "error.invalidSubscription",
  "Too many push subscriptions": "error.tooManyPush",
  "Too many pinned workspaces": "error.tooManyPins",
  "Notification permission denied": "settings.notifyDenied",
  "current password is incorrect": "error.currentPassword",
  "too many attempts": "error.tooManyAttempts",
  "setup code required": "setup.codeWrong",
  "operator password is set by GLASSYS_OPERATOR_PASSWORD_HASH": "error.passwordFromEnv",
};

export function operatorError(message: string, t: (key: string) => string): string {
  const key = MESSAGE_KEYS[message];
  if (key) return t(key);
  if (/git fetch failed/i.test(message)) return t("error.gitFetch");
  return message;
}

/**
 * A phone or tablet without a pointing device: its on-screen Enter writes a newline, and the
 * Send button sends. A touch-screen laptop (or an iPad with a trackpad) still has a fine pointer
 * and a real keyboard, so Enter sends there.
 */
export function touchOnly(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(pointer: coarse)").matches && !window.matchMedia("(any-pointer: fine)").matches;
}

export function shouldSubmitOnEnter(e: { key: string; shiftKey: boolean; nativeEvent?: { isComposing?: boolean } }): boolean {
  if (e.key !== "Enter" || e.shiftKey) return false;
  if (e.nativeEvent?.isComposing) return false;
  return !touchOnly();
}
