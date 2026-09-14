import { describe, expect, it } from "bun:test";
import { JsVM, createLazyJsVM } from "../vm";

describe("createLazyJsVM", () => {
	it("runs code exactly like a real JsVM once used", async () => {
		const vm = createLazyJsVM({});
		const result = await vm.runAsync("return 1 + 1;");
		expect(result).toBe(2);
	});

	it("shares one underlying JsVM (and its vars) across repeated calls", async () => {
		const vars: Record<string, any> = { counter: 0 };
		const vm = createLazyJsVM(vars);
		await vm.runAsync("counter++;");
		await vm.runAsync("counter++;");
		expect(vars.counter).toBe(2);
	});

	it("passes instanceof checks against JsVM without being constructed", () => {
		expect(createLazyJsVM({})).toBeInstanceOf(JsVM);
	});
});
