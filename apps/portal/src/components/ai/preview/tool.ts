import type { ToolPart } from "../agentMessages";

/** Called, not answered yet: waiting for approval, or running. */
export const isPending = (t: ToolPart) =>
	t.output === undefined && t.error === undefined && t.status === undefined;

/** Ran and said so, whatever the result. */
export const isDone = (t: ToolPart) => !isPending(t);
