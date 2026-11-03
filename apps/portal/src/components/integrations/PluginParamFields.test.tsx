import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

try {
	GlobalRegistrator.register({ url: "http://localhost:5601/" });
} catch {}

mock.module("./AppConfigSelectorModal", () => ({
	AppConfigSelectorModal: ({
		isOpen,
		onSelect,
	}: {
		isOpen: boolean;
		onSelect: (k: string) => void;
	}) =>
		isOpen ? (
			<button type="button" onClick={() => onSelect("WEBHOOK_URL")}>
				Select WEBHOOK_URL
			</button>
		) : null,
}));

const { cleanup, fireEvent, render, within } = await import("@testing-library/react");
const { PluginParamFields } = await import("./PluginIntegrationForm");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

const params = {
	url: {
		type: "string" as const,
		label: "URL",
		default: "https://example.com",
		description: "Where",
	},
	key: { type: "appconfig" as const, label: "Key" },
};

const draw = (config: Record<string, unknown>, readOnly = false) => {
	const setField = mock();
	render(
		<PluginParamFields
			projectId="p1"
			variant="demo/uptime/check"
			params={params}
			names={["url", "key"]}
			config={config}
			setField={setField}
			readOnly={readOnly}
		/>,
	);
	return { setField, ui: within(document.body) };
};

test("a string param is a plain text input: no JS toggle, edits go to setField", () => {
	const { setField, ui } = draw({ url: "a" });
	expect(ui.queryByText("JS")).toBeNull();
	const input = ui.getByPlaceholderText("https://example.com") as HTMLInputElement;
	expect(input.value).toBe("a");
	expect(document.body.textContent).toContain("Where");
	fireEvent.change(input, { target: { value: "ab" } });
	expect(setField).toHaveBeenCalledWith("url", "ab");
});

test("an appconfig param shows the picker and stores the pick as cfg:KEY", () => {
	const { setField, ui } = draw({});
	fireEvent.click(ui.getByRole("button", { name: "Use app config value" }));
	fireEvent.click(ui.getByText("Select WEBHOOK_URL"));
	expect(setField).toHaveBeenCalledWith("key", "cfg:WEBHOOK_URL");
});

test("an appconfig param shows a stored cfg:KEY and an older bare key", () => {
	draw({ key: "cfg:WEBHOOK_URL" });
	expect(document.body.textContent).toContain("WEBHOOK_URL");
	cleanup();
	const { ui } = draw({ key: "OLD_KEY" });
	expect((ui.getAllByRole("textbox").at(-1) as HTMLInputElement).value).toBe("OLD_KEY");
});

test("read-only disables both fields", () => {
	const { ui } = draw({ url: "a", key: "" }, true);
	expect((ui.getByPlaceholderText("https://example.com") as HTMLInputElement).disabled).toBe(true);
	expect(
		(ui.getByRole("button", { name: "Use app config value" }) as HTMLButtonElement).disabled,
	).toBe(true);
});

test("what the server would refuse is said under the field, and the server's own refusal replaces it", () => {
	const required = { host: { type: "string" as const, label: "Host", required: true } };
	const view = render(
		<PluginParamFields
			projectId="p1"
			variant="demo/uptime/check"
			params={required}
			names={["host"]}
			config={{ host: "" }}
			setField={mock()}
		/>,
	);
	expect(within(document.body).getByRole("alert").textContent).toBe("Host is required");
	view.rerender(
		<PluginParamFields
			projectId="p1"
			variant="demo/uptime/check"
			params={required}
			names={["host"]}
			config={{ host: "" }}
			setField={mock()}
			errors={{ host: "host is down" }}
		/>,
	);
	expect(within(document.body).getByRole("alert").textContent).toBe("host is down");
});
