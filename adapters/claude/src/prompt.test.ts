import { describe, expect, it } from "vitest";
import { claudeUserContent } from "./index.js";

describe("claudeUserContent", () => {
  it("sends text and logs as text, not as image parts", () => {
    const content = claudeUserContent("see log", [
      { path: "/tmp/a.log", mime: "text/plain", name: "a.log", body: Buffer.from("log") },
    ]);
    expect(typeof content).toBe("string");
    expect(content).toContain("a.log");
  });

  it("sends image bytes as image parts", () => {
    const content = claudeUserContent("see pic", [
      { path: "/tmp/a.png", mime: "image/png", name: "a.png", body: Buffer.from("hi") },
    ]);
    expect(Array.isArray(content)).toBe(true);
    const parts = content as Array<Record<string, unknown>>;
    expect(parts.some((p) => p.type === "image")).toBe(true);
    expect(parts.some((p) => p.type === "text")).toBe(true);
  });
});
