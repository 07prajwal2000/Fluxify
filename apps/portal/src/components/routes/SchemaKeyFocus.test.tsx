import { afterAll, afterEach, expect, test } from "bun:test";
import type { ValidationSchema } from "@fluxify/components";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

// not `screen`: it stays bound to the document of whichever test file loaded RTL first
const { cleanup, fireEvent, render, within } = await import("@testing-library/react");
const { useState } = await import("react");
const { SchemaEditor } = await import("@fluxify/components");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

function Controlled({ initial }: { initial: ValidationSchema }) {
	const [schema, setSchema] = useState(initial);
	return <SchemaEditor value={schema} onChange={setSchema} />;
}

// #1064: a saved schema's properties carry no id, and the row was keyed by its
// key text, so every keystroke remounted the row and dropped the focus
test("a saved property's key input survives being edited", () => {
	render(
		<Controlled
			initial={{ dataType: "object", properties: [{ key: "name", dataType: "str", rules: [] }] }}
		/>,
	);
	const input = within(document.body).getByLabelText("Property key") as HTMLInputElement;
	input.focus();
	fireEvent.change(input, { target: { value: "names" } });
	fireEvent.change(input, { target: { value: "namesake" } });
	const after = within(document.body).getByLabelText("Property key") as HTMLInputElement;
	expect(after.value).toBe("namesake");
	expect(after).toBe(input);
	expect(document.activeElement).toBe(input);
});
