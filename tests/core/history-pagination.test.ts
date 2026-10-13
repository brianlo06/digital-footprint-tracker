import {
  HISTORY_PAGE_SIZE,
  parseHistoryPage,
  takeHistoryPage,
} from "@/app/(protected)/history/pagination";
import { describe, expect, it } from "vitest";

describe("history pagination", () => {
  it("accepts only a bounded positive page number", () => {
    expect(parseHistoryPage("1")).toBe(1);
    expect(parseHistoryPage("37")).toBe(37);
    expect(parseHistoryPage("9999")).toBe(500);
    for (const value of [undefined, "", "0", "-1", "1.5", "01", "2e3", "12345", " 2", "abc"]) {
      expect(parseHistoryPage(value)).toBe(1);
    }
    expect(parseHistoryPage(["2", "3"])).toBe(1);
  });

  it("reports a next page only when a row beyond the page was fetched", () => {
    const full = Array.from({ length: HISTORY_PAGE_SIZE }, (_, index) => index);
    expect(takeHistoryPage(full)).toEqual({ items: full, hasNext: false });
    expect(takeHistoryPage([...full, HISTORY_PAGE_SIZE])).toEqual({ items: full, hasNext: true });
    expect(takeHistoryPage([])).toEqual({ items: [], hasNext: false });
  });
});
