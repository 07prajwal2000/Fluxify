import { describe, expect, it } from "bun:test";
import { DeleteButton } from "./DeleteButton";
import { DeleteIconButton } from "./DeleteIconButton";

describe("DeleteButton and DeleteIconButton components", () => {
	it("exports DeleteButton and DeleteIconButton functions", () => {
		expect(typeof DeleteButton).toBe("function");
		expect(typeof DeleteIconButton).toBe("function");
	});
});
