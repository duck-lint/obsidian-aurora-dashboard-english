import { describe, expect, it } from "vitest";
import {
  activityLevel,
  countWords,
  dayKeysEndingToday,
  extractOpenTasks,
  formatCompactNumber,
  localDateKey
} from "./core";

describe("countWords", () => {
  it("counts Chinese characters and Latin words", () => {
    expect(countWords("# 标题\n\nHello world，这是测试。")).toBe(8);
  });

  it("ignores frontmatter and fenced code", () => {
    const source = [
      "---",
      "title: hidden metadata",
      "---",
      "可见文本",
      "```ts",
      "const hidden = true;",
      "```"
    ].join("\n");
    expect(countWords(source)).toBe(4);
  });

  it("uses visible wikilink aliases", () => {
    expect(countWords("[[Very long target|显示名]]")).toBe(3);
  });
});
describe("extractOpenTasks", () => {
  it("finds only unchecked markdown tasks", () => {
    const tasks = extractOpenTasks("- [ ] First\n- [x] Done\n  * [ ] 第二项");
    expect(tasks).toEqual([
      { line: 0, text: "First" },
      { line: 2, text: "第二项" }
    ]);
  });
});

describe("date and presentation helpers", () => {
  it("builds inclusive day ranges ending today", () => {
    expect(dayKeysEndingToday(3, new Date(2026, 6, 31))).toEqual([
      "2026-07-29",
      "2026-07-30",
      "2026-07-31"
    ]);
  });

  it("formats local dates", () => {
    expect(localDateKey(new Date(2026, 0, 2))).toBe("2026-01-02");
  });

  it("maps values to stable activity levels", () => {
    expect(activityLevel(0, 100)).toBe(0);
    expect(activityLevel(8, 100)).toBe(1);
    expect(activityLevel(50, 100)).toBe(4);
    expect(activityLevel(100, 100)).toBe(5);
  });

  it("formats Chinese compact numbers", () => {
    expect(formatCompactNumber(369_155)).toBe("36.9 万");
    expect(formatCompactNumber(368)).toBe("368");
  });
});
