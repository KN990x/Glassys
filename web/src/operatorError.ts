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
};

export function operatorError(message: string, t: (key: string) => string): string {
  const key = MESSAGE_KEYS[message];
  if (key) return t(key);
  if (/git fetch failed/i.test(message)) return t("error.gitFetch");
  return message;
}

export function shouldSubmitOnEnter(e: { key: string; shiftKey: boolean; nativeEvent?: { isComposing?: boolean } }): boolean {
  if (e.key !== "Enter" || e.shiftKey) return false;
  if (e.nativeEvent?.isComposing) return false;
  if (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0) return false;
  return true;
}
