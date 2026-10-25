import type { ApiPlaygroundResponse } from "@fluxify/components";

export type SampleResult = { ok: true; sample: unknown } | { ok: false; reason: string };

/** What a response can teach: a real status and a body that parses as JSON. */
export function sampleFrom(response: ApiPlaygroundResponse): SampleResult {
	if (response.status < 100 || response.status > 599) {
		return { ok: false, reason: "The request failed, there is no response to save" };
	}
	const body = response.body?.trim();
	if (!body) return { ok: false, reason: "The response has no body" };
	try {
		return { ok: true, sample: JSON.parse(body) };
	} catch {
		return { ok: false, reason: "Only JSON responses can be saved as a schema" };
	}
}
