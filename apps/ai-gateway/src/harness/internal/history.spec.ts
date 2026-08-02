import { describe, expect, it } from "bun:test";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import {
	HISTORY_MESSAGE_BUDGET,
	HISTORY_TOTAL_BUDGET,
	capHistory,
	truncateMiddle,
} from "./history";

describe("truncateMiddle", () => {
	it("leaves a short message alone", () => {
		expect(truncateMiddle("hello")).toBe("hello");
	});

	it("caps a long message and keeps both ends", () => {
		const text = `START${"x".repeat(HISTORY_MESSAGE_BUDGET * 3)}END`;
		const out = truncateMiddle(text);
		expect(out.length).toBeLessThanOrEqual(HISTORY_MESSAGE_BUDGET);
		expect(out.startsWith("START")).toBe(true);
		expect(out.endsWith("END")).toBe(true);
		expect(out).toContain("[trimmed]");
	});
});

describe("capHistory", () => {
	it("returns a history that already fits unchanged", () => {
		const messages = [new HumanMessage("build it"), new AIMessage("done")];
		expect(capHistory(messages)).toEqual(messages);
	});

	it("drops the oldest turns until the total fits, keeping the newest", () => {
		const big = "x".repeat(HISTORY_TOTAL_BUDGET / 2);
		const messages = [
			new HumanMessage(`old ${big}`),
			new AIMessage(`old ${big}`),
			new HumanMessage(`recent ${big}`),
			new AIMessage("newest"),
		];

		const out = capHistory(messages);

		expect(out.length).toBeLessThan(messages.length);
		expect(out.at(-1)!.content).toBe("newest");
		expect(
			out.reduce((n, m) => n + (m.content as string).length, 0),
		).toBeLessThanOrEqual(HISTORY_TOTAL_BUDGET);
	});

	it("never returns more than the budget even when one message is huge", () => {
		const out = capHistory([new AIMessage("x".repeat(HISTORY_TOTAL_BUDGET * 2))]);
		expect(out).toEqual([]);
	});
});
