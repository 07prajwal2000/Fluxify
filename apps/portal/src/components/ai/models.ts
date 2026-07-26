/** Selectable harness models. Static for now — swap for a query when the
 *  gateway exposes an available-models endpoint. */
export const AI_MODELS = [
	{ id: "claude-opus-4-8", name: "Opus 4.8" },
	{ id: "claude-sonnet-5", name: "Sonnet 5" },
	{ id: "claude-haiku-4-5", name: "Haiku 4.5" },
] as const;

export const DEFAULT_MODEL = AI_MODELS[0].id;
