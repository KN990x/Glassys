import { describe, expect, it } from "vitest";
import { localForSend } from "./index.js";
import type { AdapterCreateOptions } from "@glassys/adapter-contract";

const opts: AdapterCreateOptions = {
  cwd: "/tmp/ws",
  model: "grok-4.6",
  modelParams: [],
  storeDir: "/tmp/store",
  options: { sandbox: true, autoRun: false, settingSources: ["project"] },
};

describe("localForSend", () => {
  it("omits local when not forcing", () => {
    expect(localForSend(opts, false)).toBeUndefined();
    expect(localForSend(opts)).toBeUndefined();
  });

  it("keeps cwd, sandbox, and autoReview when forcing", () => {
    const local = localForSend(opts, true);
    expect(local).toMatchObject({
      cwd: "/tmp/ws",
      force: true,
      sandboxOptions: { enabled: true },
      autoReview: true,
    });
  });
});
