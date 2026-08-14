import { expect, test } from "bun:test";
import { CloseButton, ModalCloseButton } from "./CloseButton";

test("CloseButton and ModalCloseButton are exported functions", () => {
	expect(typeof CloseButton).toBe("function");
	expect(typeof ModalCloseButton).toBe("function");
	expect(CloseButton).toBe(ModalCloseButton);
});
