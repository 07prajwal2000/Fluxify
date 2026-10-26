import type { AiAdapter } from "@fluxify/sdk/integrations";
import { type LanguageModelMiddleware, wrapLanguageModel } from "ai";

type Span = <T>(name: string, fn: () => T | Promise<T>) => Promise<T>;

/** what a model call records: finish reason and tokens; prompts and outputs stay out of the trace */
const summary = (r: { finishReason: unknown; usage: unknown }) => ({
	finishReason: r.finishReason,
	usage: r.usage,
});

/**
 * Every call of a model becomes a `ai:<provider>/<model>` span under the block
 * (`ctx.span`), so the run trace shows where an agent loop spent its time. A
 * stream's span ends when the stream does.
 */
const middleware = (span: Span, name: string): LanguageModelMiddleware => ({
	specificationVersion: "v4",
	async wrapGenerate({ doGenerate }) {
		let result!: Awaited<ReturnType<typeof doGenerate>>;
		await span(name, async () => {
			result = await doGenerate();
			return summary(result);
		});
		return result;
	},
	async wrapStream({ doStream }) {
		let finish!: (value: unknown) => void;
		let fail!: (error: unknown) => void;
		const done = new Promise((res, rej) => {
			finish = res;
			fail = rej;
		});
		// ponytail: a stream the caller abandons never flushes, so its span is not recorded
		span(name, () => done).catch(() => {});
		try {
			const result = await doStream();
			let last: unknown;
			const stream = result.stream.pipeThrough(
				new TransformStream({
					transform(part, out) {
						if (part.type === "finish") last = summary(part);
						if (part.type === "error") fail(part.error);
						out.enqueue(part);
					},
					flush: () => finish(last),
				}),
			);
			return { ...result, stream };
		} catch (error) {
			fail(error);
			throw error;
		}
	},
});

/** the run's signal joined to whatever the caller passed (#1000) */
const joined = (own: AbortSignal | undefined, signal: AbortSignal) =>
	own ? AbortSignal.any([own, signal]) : signal;

/** the block's view of a pooled AI adapter: every model call is cancelled with the run (#1000) */
export function abortableAi(adapter: AiAdapter, signal: AbortSignal): AiAdapter {
	return {
		languageModel(modelId) {
			return wrapLanguageModel({
				model: adapter.languageModel(modelId),
				middleware: {
					specificationVersion: "v4",
					transformParams: async ({ params }) => ({
						...params,
						abortSignal: joined(params.abortSignal, signal),
					}),
				},
			});
		},
		...(adapter.embeddingModel && {
			embeddingModel(modelId) {
				const model = adapter.embeddingModel!(modelId);
				// a view, not a copy: the provider's model keeps its own prototype
				return Object.assign(Object.create(model), {
					doEmbed: (options: Parameters<typeof model.doEmbed>[0]) =>
						model.doEmbed({ ...options, abortSignal: joined(options.abortSignal, signal) }),
				});
			},
		}),
	};
}

/** the block's view of a pooled AI adapter: same models, each call traced under the block */
export function tracedAi(adapter: AiAdapter, span: Span): AiAdapter {
	return {
		languageModel(modelId) {
			const model = adapter.languageModel(modelId);
			return wrapLanguageModel({
				model,
				middleware: middleware(span, `ai:${model.provider}/${model.modelId}`),
			});
		},
		...(adapter.embeddingModel && {
			embeddingModel: (modelId) => adapter.embeddingModel!(modelId),
		}),
	};
}
