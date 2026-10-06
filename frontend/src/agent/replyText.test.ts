import { describe, expect, it } from "vitest";
import { appendReplyText } from "./replyText";

describe("appendReplyText", () => {
  it("streams tokens of one message together", () => {
    expect(appendReplyText("Cutter is", " indeed", false)).toBe("Cutter is indeed");
  });

  it("starts a new paragraph when text resumes after a tool call", () => {
    // the bug: two messages either side of a tool call read "operator.Cutter"
    expect(appendReplyText("an available operator.", "Cutter", true)).toBe(
      "an available operator.\n\nCutter",
    );
  });

  it("does not open a reply with a blank paragraph", () => {
    expect(appendReplyText("", "Run #76", true)).toBe("Run #76");
  });

  it("does not stack whitespace either side of the break", () => {
    expect(appendReplyText("done. ", " Next", true)).toBe("done.\n\nNext");
  });
});
