import { describe, expect, it, vi, afterEach } from "vitest";
import { loadDraft, saveDraft } from "./draftStorage";

describe("draftStorage", () => {
  afterEach(() => {
    sessionStorage.clear();
  });

  it("does not write when threadId is null", () => {
    saveDraft(null, "hello", []);
    expect(sessionStorage.length).toBe(0);
    expect(loadDraft(null)).toEqual({ text: "", attachments: [] });
  });

  it("round-trips text and attachments for a thread", () => {
    saveDraft("t1", "draft", [{ id: "a", mime: "image/png", name: "x.png" }]);
    expect(loadDraft("t1")).toEqual({
      text: "draft",
      attachments: [{ id: "a", mime: "image/png", name: "x.png" }],
    });
    saveDraft("t1", "", []);
    expect(loadDraft("t1")).toEqual({ text: "", attachments: [] });
  });

  it("ignores corrupt JSON", () => {
    sessionStorage.setItem("glassys_draft:t1", "{not json");
    expect(loadDraft("t1")).toEqual({ text: "", attachments: [] });
  });

  it("swallows quota errors on save", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => saveDraft("t1", "x", [])).not.toThrow();
    spy.mockRestore();
  });
});
