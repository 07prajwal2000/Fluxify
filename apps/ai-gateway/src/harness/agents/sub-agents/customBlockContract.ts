/** Shared prompt contract: custom-block settings define it; canvas authoring obeys it. */
export const CUSTOM_BLOCK_PARAMETER_CONTRACT = `
## Custom Block Caller Contract
Custom-block inputParams are public API supplied by caller blocks, not values produced inside callee graph.
- Declare every value implementation reads as \`params.<name>\` or substitutes as \`param:<name>\`; names must match exactly.
- \`text_input\`: string; \`checkbox\`: boolean; \`array_editor\`: array; \`dropdown\`: declared string options.
- \`integration_selector\`: caller supplies integration id. \`app_config_selector\`: caller supplies app-config KEY, never secret/value; read it only with \`getConfig(params.<name>)\`.
- Never put credentials, app-config values, or connection ids in custom-block definition or data.
`;

export const CUSTOM_BLOCK_EXECUTION_CONTRACT = `
## Custom Block Execution
- A custom block canvas has same DAG rules as route canvas, plus no direct or indirect call to itself.
- A caller block's \`invoke\` is \`sync\` (default: waits and receives callee output), \`async\` (worker-local fire-and-forget; no output), or \`queued\` (durable background job; no output). Never generate \`scheduled\` — runtime name is \`queued\`.
- In custom-block canvas, \`params\` remains caller configuration throughout; \`input\` is previous block output. Keep them separate.
- A response block returns its HTTP result to caller. If graph ends without response, last executed block output flows to caller's next block. When task says "leave graph open", "pass output to caller", or "continue outside custom block", response block is FORBIDDEN: end the final non-response block with \`"connections": []\`.
`;
