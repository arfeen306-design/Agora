import { describe, expect, test } from "vitest";

import {
  getCommentPresetFamilies,
  getCommentPresetsForSubject,
  resolveReportCardCommentFamily,
} from "@/lib/report-card-comment-presets";

describe("report card comment presets", () => {
  test("keeps 10 presets for every category in every family", () => {
    const families = getCommentPresetFamilies();

    for (const family of Object.values(families)) {
      for (const presets of Object.values(family)) {
        expect(presets).toHaveLength(10);
      }
    }
  });

  test("maps core subjects to the expected families", () => {
    expect(resolveReportCardCommentFamily("Mathematics")).toBe("mathematics");
    expect(resolveReportCardCommentFamily("English")).toBe("languages");
    expect(resolveReportCardCommentFamily("Physics")).toBe("science");
    expect(resolveReportCardCommentFamily("Business Studies")).toBe("general");
  });

  test("returns ready-to-use subject presets", () => {
    const presets = getCommentPresetsForSubject("Mathematics", "extraordinary");
    expect(presets[0]).toMatch(/exceptional accuracy/i);
    expect(presets).toHaveLength(10);
  });
});
