import { describe, expect, it } from "bun:test";
import type { AiAdapter } from "@fluxify/sdk/integrations";
import { abortableAi } from "./ctxAiSpans";

/** a model that hands back the options it was called with */
function fakeAdapter(): AiAdapter {
	const echo = async (options: any) => options;
	return {
		languageModel: () =>
			({
				specificationVersion: "v4",
				provider: "fake",
				modelId: "m",
				supportedUrls: {},
				doGenerate: echo,
				doStream: echo,
			}) as any,
		embeddingModel: () =>
			({ specificationVersion: "v4", provider: "fake", modelId: "e", doEmbed: echo }) as any,
	};
}

describe("abortableAi", () => {
	it("gives every model call the run's signal", async () => {
		const ctrl = new AbortController();
		const ai = abortableAi(fakeAdapter(), ctrl.signal);
		const generated: any = await ai.languageModel().doGenerate({ prompt: [] } as any);
		const embedded: any = await ai.embeddingModel!("e").doEmbed({ values: ["x"] } as any);
		ctrl.abort();
		expect(generated.abortSignal.aborted).toBe(true);
		expect(embedded.abortSignal.aborted).toBe(true);
	});

	it("keeps the caller's own signal too", async () => {
		const own = new AbortController();
		const ai = abortableAi(fakeAdapter(), new AbortController().signal);
		const generated: any = await ai
			.languageModel()
			.doGenerate({ prompt: [], abortSignal: own.signal } as any);
		own.abort();
		expect(generated.abortSignal.aborted).toBe(true);
	});
});
