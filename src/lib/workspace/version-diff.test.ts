import { describe, expect, it } from "vitest";
import { summarizeVersionDiff } from "./version-diff";

describe("summarizeVersionDiff", () => {
  it("reports the first version without a baseline", () => {
    expect(summarizeVersionDiff(null, "# 标题\n\n内容")).toEqual({
      addedLines: 3,
      removedLines: 0,
      segments: [],
    });
  });

  it("summarizes additions and removals with capped snippets", () => {
    const summary = summarizeVersionDiff("保留\n删除", "保留\n新增");
    expect(summary.addedLines).toBe(1);
    expect(summary.removedLines).toBe(1);
    expect(summary.segments).toEqual([
      { type: "removed", text: "删除" },
      { type: "added", text: "新增" },
    ]);
  });

  it("handles identical content without change segments", () => {
    expect(summarizeVersionDiff("同一段", "同一段")).toEqual({ addedLines: 0, removedLines: 0, segments: [] });
  });
});
