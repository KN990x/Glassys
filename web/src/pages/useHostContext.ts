import { useCallback, useEffect, useState } from "react";
import { api } from "../api";

/**
 * Who and where the agent works (user@host, loopback-only, the workspace's git branch) and the
 * recent and pinned workspaces, read again whenever the workspace changes.
 */
export function useHostContext(cwd: string) {
  const [hostLabel, setHostLabel] = useState("");
  const [loopback, setLoopback] = useState(false);
  const [git, setGit] = useState<{ branch: string; dirty: boolean } | undefined>();
  const [pins, setPins] = useState<string[]>([]);
  const [recents, setRecents] = useState<string[]>([]);

  const refreshWorkspaces = useCallback(async () => {
    try {
      const r = await api.workspaces();
      setRecents(r.recents || []);
      setPins(r.pins || []);
    } catch {
      /* the lists keep what they had */
    }
  }, []);

  useEffect(() => {
    /* No thread list over HTTP: every WS handshake sends threads.snapshot, and a slower HTTP
       reply landed after a newer snapshot and put an old list back. */
    api
      .reachability()
      .then((r) => {
        const parts = [r.user, r.hostname].filter((p): p is string => Boolean(p && p.trim()));
        setHostLabel(parts.join("@"));
        setLoopback(r.loopback);
        setGit(r.git);
      })
      .catch(() => undefined);
    void refreshWorkspaces();
  }, [refreshWorkspaces, cwd]);

  return { hostLabel, loopback, git, pins, setPins, recents, refreshWorkspaces };
}
