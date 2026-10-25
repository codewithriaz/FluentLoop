import { describe, expect, it } from "vitest";
import { diffWords } from "./wordDiff";

describe("diffWords", () => {
  it("ignores case and punctuation", () => {
    const d = diffWords("Could you send me the invoice?", "could you send me the invoice");
    expect(d.ratio).toBe(1);
    expect(d.tokens.every((t) => t.status === "match")).toBe(true);
  });

  it("marks missing and extra words", () => {
    const d = diffWords("I would like to book a meeting.", "I like to book the meeting");
    expect(d.matched).toBe(5);
    expect(d.expected).toBe(7);
    expect(d.tokens.filter((t) => t.status === "missing").map((t) => t.word)).toEqual(["would", "a"]);
    expect(d.tokens.filter((t) => t.status === "extra").map((t) => t.word)).toEqual(["the"]);
  });

  it("handles empty input", () => {
    expect(diffWords("Hello there.", "").ratio).toBe(0);
    expect(diffWords("", "hi").expected).toBe(0);
  });
});
