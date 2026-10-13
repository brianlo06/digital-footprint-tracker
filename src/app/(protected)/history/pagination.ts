export const HISTORY_PAGE_SIZE = 20;
const MAX_HISTORY_PAGE = 500;

/** Parses an untrusted 1-based page query value, falling back to the first page. */
export function parseHistoryPage(value: string | string[] | undefined): number {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,3}$/.test(value)) return 1;
  return Math.min(Number(value), MAX_HISTORY_PAGE);
}

/**
 * Splits one over-fetched row from a page so the caller knows whether a next
 * page exists without a separate count query.
 */
export function takeHistoryPage<T>(rows: readonly T[]): {
  readonly items: readonly T[];
  readonly hasNext: boolean;
} {
  return { items: rows.slice(0, HISTORY_PAGE_SIZE), hasNext: rows.length > HISTORY_PAGE_SIZE };
}
