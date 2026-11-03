import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * React Flow reads a socket's position from its transformed box but its size
 * from the untransformed one, so a socket that is scaled or moved by a CSS
 * transform while the node is measured (a block just added is selected, hovered)
 * puts every edge off its dot. Growth belongs on a child, like `.fx-handle__dot`.
 */
test("no rule scales or moves a socket itself", () => {
	const css = readFileSync(new URL("./blocks.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
	const offenders = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
		.filter(([, selector, body]) => {
			const onSocket = selector!.split(",").some((s) => /react-flow__handle(:[\w-]+)*\s*$/.test(s));
			return onSocket && /(^|[;\s])(scale|translate|rotate)\s*:|transform\s*:(?!\s*none)/.test(body!);
		})
		.map(([, selector]) => selector!.trim());
	expect(offenders).toEqual([]);
});
