import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { BadRequestError } from "../../../../errors/badRequestError";
import * as triggerKinds from "../../../../modules/plugins/triggerKinds";
import * as validateDispatch from "../../../../modules/triggers/validateDispatch";
import { assertConnector } from "../connectors";

const row = {
	name: "acme/t",
	version: "1.0.0",
	integrity: "sha-1",
	approval: "approved",
	devEnabled: true,
	prodEnabled: false,
};
const entry = (validate?: boolean) => ({
	name: "acme/t/poll",
	label: "Poll",
	icon: "data:",
	permissions: {},
	params: { every: { type: "number" } },
	retry: false,
	...(validate === undefined ? {} : { validate }),
});
const check = (probe: boolean, source: Record<string, unknown> = { every: 5 }) => ({
	type: "plugin:acme/t/poll",
	projectId: "p1",
	source,
	probe,
});

let validation: ReturnType<typeof spyOn>;
const provide = (validate?: boolean) =>
	spyOn(triggerKinds, "findTriggerKind").mockResolvedValue({ row, entry: entry(validate) } as never);

beforeEach(() => {
	mock.restore();
	validation = spyOn(validateDispatch, "runTriggerValidation").mockResolvedValue([]);
});
afterEach(() => mock.restore());

describe("assertConnector, plugin triggers", () => {
	it("asks the worker on create, enable or a source change, with the approved version", async () => {
		provide(true);
		validation.mockResolvedValue(["polling often is heavy"]);
		expect(await assertConnector(check(true))).toEqual(["polling often is heavy"]);
		expect(validation).toHaveBeenCalledWith({
			projectId: "p1",
			kind: "acme/t/poll",
			integrity: "sha-1",
			source: { every: 5 },
		});
	});

	it("an edit that leaves the settings alone, or a kind with no validate, never asks", async () => {
		provide(true);
		expect(await assertConnector(check(false))).toEqual([]);
		provide(false);
		expect(await assertConnector(check(true))).toEqual([]);
		// a manifest from before `validate` existed
		provide(undefined);
		expect(await assertConnector(check(true))).toEqual([]);
		expect(validation).not.toHaveBeenCalled();
	});

	it("bad params are refused before any worker is asked", async () => {
		provide(true);
		await expect(assertConnector(check(true, { every: "x" }))).rejects.toThrow();
		expect(validation).not.toHaveBeenCalled();
	});

	it("passes on the worker's verdict: a warning with no worker, a 400 with the author's error", async () => {
		provide(true);
		validation.mockResolvedValue([validateDispatch.NO_DEV_WORKER_WARNING]);
		expect(await assertConnector(check(true))).toEqual([validateDispatch.NO_DEV_WORKER_WARNING]);
		validation.mockRejectedValue(new BadRequestError("every must be at most 60"));
		await expect(assertConnector(check(true))).rejects.toThrow("every must be at most 60");
	});
});
