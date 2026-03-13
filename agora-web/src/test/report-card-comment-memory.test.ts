import { beforeEach, describe, expect, test } from "vitest";

import {
  getFavoriteReportCardComments,
  getRecentReportCardComments,
  isFavoriteReportCardComment,
  loadReportCardCommentMemory,
  recordReportCardCommentUse,
  toggleFavoriteReportCardComment,
} from "@/lib/report-card-comment-memory";

describe("report card comment memory", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test("stores recently used comments by subject family and category", () => {
    recordReportCardCommentUse({
      subjectName: "Mathematics",
      category: "good_better",
      comment: " Solves questions carefully and shows clear working. ",
    });

    const entries = loadReportCardCommentMemory();
    const recent = getRecentReportCardComments(entries, {
      subjectName: "Mathematics",
      category: "good_better",
    });

    expect(recent).toHaveLength(1);
    expect(recent[0].comment_text).toBe("Solves questions carefully and shows clear working.");
    expect(recent[0].use_count).toBe(1);
  });

  test("favorites can be toggled on and off without losing recent usage", () => {
    recordReportCardCommentUse({
      subjectName: "English",
      category: "average",
      comment: "Needs to expand written answers with more detail.",
    });

    toggleFavoriteReportCardComment({
      subjectName: "English",
      category: "average",
      comment: "Needs to expand written answers with more detail.",
    });

    let entries = loadReportCardCommentMemory();
    let favorites = getFavoriteReportCardComments(entries, {
      subjectName: "English",
      category: "average",
    });

    expect(favorites).toHaveLength(1);
    expect(
      isFavoriteReportCardComment(entries, {
        subjectName: "English",
        category: "average",
        comment: "Needs to expand written answers with more detail.",
      })
    ).toBe(true);

    toggleFavoriteReportCardComment({
      subjectName: "English",
      category: "average",
      comment: "Needs to expand written answers with more detail.",
    });

    entries = loadReportCardCommentMemory();
    favorites = getFavoriteReportCardComments(entries, {
      subjectName: "English",
      category: "average",
    });

    expect(favorites).toHaveLength(0);
    expect(
      getRecentReportCardComments(entries, {
        subjectName: "English",
        category: "average",
      })
    ).toHaveLength(1);
  });

  test("keeps science comments separate from mathematics comments", () => {
    recordReportCardCommentUse({
      subjectName: "Physics",
      category: "good_better",
      comment: "Explains scientific ideas with growing confidence.",
    });
    recordReportCardCommentUse({
      subjectName: "Mathematics",
      category: "good_better",
      comment: "Explains each step and solves routine questions well.",
    });

    const entries = loadReportCardCommentMemory();

    expect(
      getRecentReportCardComments(entries, {
        subjectName: "Physics",
        category: "good_better",
      }).map((entry) => entry.comment_text)
    ).toEqual(["Explains scientific ideas with growing confidence."]);

    expect(
      getRecentReportCardComments(entries, {
        subjectName: "Mathematics",
        category: "good_better",
      }).map((entry) => entry.comment_text)
    ).toEqual(["Explains each step and solves routine questions well."]);
  });
});
