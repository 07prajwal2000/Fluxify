/**
 * Fields the caller always owns on a chat request. A user's extra body may not set
 * them: the schema refuses them on save, and `withExtraBody` drops them anyway.
 */
export const EXTRA_BODY_RESERVED = [
	"model",
	"messages",
	"tools",
	"tool_choice",
	"functions",
	"function_call",
	"stream",
	"stream_options",
	"response_format",
] as const;

const reserved = new Set<string>(EXTRA_BODY_RESERVED);

/**
 * The AI SDK's `transformRequestBody` for a user's extra body (thinking switches and
 * other vendor options). The extras sit underneath: every field the SDK or the agent
 * set on the request wins, so an extra can add a field or fill an empty one but never
 * replace what was sent. Undefined when there is nothing to add.
 */
export function withExtraBody(extra?: Record<string, unknown>) {
	const base = Object.entries(extra ?? {}).filter(([key]) => !reserved.has(key));
	if (!base.length) return undefined;
	return (args: Record<string, unknown>) => ({
		...Object.fromEntries(base),
		...Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined)),
	});
}
