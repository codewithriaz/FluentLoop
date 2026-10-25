import { describe, expect, it } from "vitest";
import { VOICES, VOICE_GROUPS, voiceInfo } from "./voices";

describe("voices", () => {
  it("describes voice ids", () => {
    expect(voiceInfo("af_heart")).toEqual({ id: "af_heart", name: "Heart", accent: "American", gender: "Female" });
    expect(voiceInfo("bm_george")).toMatchObject({ name: "George", accent: "British", gender: "Male" });
  });
  it("groups all 28 voices", () => {
    expect(VOICES).toHaveLength(28);
    expect(VOICE_GROUPS.reduce((n, g) => n + g.voices.length, 0)).toBe(28);
  });
});
