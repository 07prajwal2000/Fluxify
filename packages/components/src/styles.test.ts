import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// Tailwind only emits a class it finds in a scanned file, and the portal does not
// scan this package's source on its own. A component folder missing here renders
// its own classes as nothing: the JS editor's expand button had no `top-1`, so it
// fell to the bottom-right corner (#950).
const scanned = [...readFileSync(new URL("./styles.css", import.meta.url), "utf8").matchAll(/@source "\.\/([^"]+)"/g)].map(
	(m) => m[1],
);

test("the JS editor's folder is scanned, so its expand button keeps its position classes", () => {
	expect(scanned).toContain("JavaScriptTextArea");
});
