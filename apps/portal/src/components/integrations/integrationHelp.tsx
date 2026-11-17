export const INTEGRATION_HELP: Record<string, { docsUrl: string; tip: string }> = {
	database: {
		docsUrl: "https://docs.fluxify.rest/integrations/databases.html",
		tip: "Use a dedicated read-only role or restricted database user for Fluxify to limit blast radius.",
	},
	kv: {
		docsUrl: "https://docs.fluxify.rest/integrations/kv-stores.html",
		tip: "Prefix cache keys with project namespaces to prevent collisions across environments.",
	},
	ai: {
		docsUrl: "https://docs.fluxify.rest/integrations/ai-models.html",
		tip: "Store API keys as encrypted variables in App Config and bind them using cfg: keys.",
	},
	observability: {
		docsUrl: "https://docs.fluxify.rest/integrations/observability.html",
		tip: "Use OpenTelemetry (OTLP) to unify logs, metrics, and trace export across your stack.",
	},
	queue: {
		docsUrl: "https://docs.fluxify.rest/integrations/message-queues.html",
		tip: "Set a dead-letter topic under Advanced, or one bad message holds up its partition until it succeeds. For SQS, give the queue a redrive policy in AWS instead; for RabbitMQ, a dead-letter exchange on the queue.",
	},
	storage: {
		docsUrl: "https://docs.fluxify.rest/integrations/object-storage.html",
		tip: "Give the keys access to one bucket only, and keep the secret in an encrypted App Config key.",
	},
	baas: {
		docsUrl: "https://docs.fluxify.rest/integrations/databases.html",
		tip: "Ensure all service endpoints and tokens are secured via App Config secrets.",
	},
};
