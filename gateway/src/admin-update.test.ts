import { describe, expect, it } from "vitest";
import { detectService, setDetectServiceForTests } from "./admin-update.js";

describe("admin update", () => {
  it("treats GLASSYS_SERVICE=1 as the user service", () => {
    expect(detectService({ GLASSYS_SERVICE: "1" }, "darwin")).toBe("launchd");
    expect(detectService({ GLASSYS_SERVICE: "1" }, "linux")).toBe("systemd");
  });

  it("honors the test override", () => {
    setDetectServiceForTests("none");
    expect(detectService({ GLASSYS_SERVICE: "1" }, "darwin")).toBe("none");
    setDetectServiceForTests(null);
  });
});
