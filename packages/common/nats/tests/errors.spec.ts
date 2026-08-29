import { describe, expect, it } from "bun:test";
import {
	JetStreamApiCodes,
	JetStreamApiError,
	isConsumerNotFound,
	isJetStreamApiError,
	isStreamNotFound,
	isWrongLastSequence,
} from "../errors";

function apiError(errCode: number): JetStreamApiError {
	return new JetStreamApiError({
		code: 404,
		err_code: errCode,
		description: "test",
	});
}

describe("error predicates", () => {
	it("recognises a missing stream", () => {
		expect(isStreamNotFound(apiError(JetStreamApiCodes.StreamNotFound))).toBe(true);
		expect(isConsumerNotFound(apiError(JetStreamApiCodes.StreamNotFound))).toBe(false);
	});

	it("recognises a missing consumer", () => {
		expect(isConsumerNotFound(apiError(JetStreamApiCodes.ConsumerNotFound))).toBe(true);
	});

	it("treats both wrong-sequence codes as a lost race", () => {
		expect(isWrongLastSequence(apiError(JetStreamApiCodes.StreamWrongLastSequence))).toBe(true);
		expect(
			isWrongLastSequence(apiError(JetStreamApiCodes.StreamWrongLastSequenceUnknown)),
		).toBe(true);
	});

	it("does not claim ordinary errors", () => {
		// this is the whole point: `catch {}` used to swallow these alongside
		// "already exists", so a bad credential looked like a healthy boot
		const plain = new Error("connection refused");
		expect(isJetStreamApiError(plain)).toBe(false);
		expect(isStreamNotFound(plain)).toBe(false);
		expect(isConsumerNotFound(plain)).toBe(false);
		expect(isWrongLastSequence(plain)).toBe(false);
	});
});
