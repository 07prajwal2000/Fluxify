import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

// the real selector pulls app configs over the network; only its label matters here
mock.module("../AppConfigSelector", () => ({
	AppConfigSelector: ({ label }: { label: string }) => <span>{label}</span>,
}));

// render's own queries: `screen` stays bound to the document of whichever test file loaded RTL first
const { cleanup, fireEvent, render } = await import("@testing-library/react");
const { CredentialsUrlForm } = await import("./CredentialsUrlForm");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

const placeholders = { name: "", host: "", port: "", username: "", password: "", url: "" };

function form(config: Record<string, unknown>, setField = mock(), defaultMaxConnections?: number) {
	return (
		<CredentialsUrlForm
			projectId="p"
			name="cache"
			onName={() => {}}
			config={config}
			setField={setField}
			placeholders={placeholders}
			defaultMaxConnections={defaultMaxConnections}
		/>
	);
}

test("shows the URL field when the saved config arrives after mount", () => {
	// the edit page mounts on an empty config, then fills it in
	const view = render(form({}));
	expect(view.queryByText("Host")).not.toBeNull();

	view.rerender(form({ source: "url", url: "redis://cache:6379" }));
	expect(view.queryByText("URL")).not.toBeNull();
	expect(view.queryByText("Host")).toBeNull();
});

test("switching tabs writes the source into the config", () => {
	const setField = mock();
	const view = render(form({ source: "credentials" }, setField));
	fireEvent.click(view.getByText("Via URL"));
	expect(setField).toHaveBeenCalledWith("source", "url");
});

test("max connections shows the default, keeps edits in range, and is hidden without one", () => {
	const setField = mock();
	const view = render(form({}, setField, 10));
	const input = view.getByLabelText("Max connections") as HTMLInputElement;
	expect(input.value).toBe("10");
	fireEvent.change(input, { target: { value: "25" } });
	fireEvent.change(input, { target: { value: "0" } });
	fireEvent.change(input, { target: { value: "5000" } });
	expect(setField.mock.calls).toEqual([
		["maxConnections", 25],
		["maxConnections", 1],
		["maxConnections", 1000],
	]);

	view.rerender(form({}, setField)); // KV stores have no pool setting
	expect(view.queryByLabelText("Max connections")).toBeNull();
});
