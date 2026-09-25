/**
 * Editor types for `t.expect`, the checks custom JS assertions and block hooks
 * share (server: `modules/testRunner/expect.ts`).
 */
export const EXPECT_TYPES = `
type Matchers = {
  toBe(expected: unknown): void;
  /** deep equality, for objects and arrays */
  toEqual(expected: unknown): void;
  toBeTruthy(): void;
  toBeFalsy(): void;
  toBeNull(): void;
  toBeUndefined(): void;
  toBeDefined(): void;
  /** a string contains the substring, or an array contains the item */
  toContain(item: unknown): void;
  toHaveLength(length: number): void;
  /** \`a.b[0].c\`; with a value, the property must also equal it */
  toHaveProperty(path: string, value?: unknown): void;
  toMatch(pattern: RegExp | string): void;
  toBeGreaterThan(n: number): void;
  toBeLessThan(n: number): void;
};

/**
 * Check a value. Each check is one line in the results; a failed check fails
 * the suite but never stops the code. \`label\` names the value in the result.
 */
type Expect = (actual: unknown, label?: string) => Matchers & { not: Matchers };
`;
