/** Where a custom block may run. Dependency-free so the portal can import it. */
export const CUSTOM_BLOCK_USAGES = ["flow", "test", "middleware"] as const;
export type CustomBlockUsage = (typeof CUSTOM_BLOCK_USAGES)[number];
