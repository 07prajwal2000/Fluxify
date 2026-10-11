/**
 * What a deployment's log shows (#739): the user's comment, with the agent's
 * own note after it when it gave one. Without a comment (an MCP client has no
 * approval box) the note stands alone. Kept apart from the tool list, which
 * imports the MCP tools that need this.
 */
export function deploymentDescription(comment?: string, note?: string) {
	const parts = [comment?.trim(), note?.trim() && `Agent: ${note.trim()}`].filter(Boolean);
	return parts.join("\n\n") || "Deployed by an agent";
}
