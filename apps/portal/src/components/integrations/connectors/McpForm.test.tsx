import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

try {
	GlobalRegistrator.register();
} catch {}

const realAppConfigSelector = { ...(await import("../AppConfigSelector")) };
mock.module("../AppConfigSelector", () => ({
	AppConfigSelector: ({ value, isDisabled, placeholder }: any) => (
		<input placeholder={placeholder} value={value} disabled={isDisabled} readOnly />
	),
}));

const { cleanup, render } = await import("@testing-library/react");
const { McpForm } = await import("./McpForm");

afterEach(cleanup);
afterAll(() => {
	mock.module("../AppConfigSelector", () => realAppConfigSelector);
	GlobalRegistrator.unregister();
});

test("mcp form is read-only for a creator (readOnly=true)", () => {
	const setField = mock();
	const onName = mock();
	const config = {
		url: "https://mcp.example.com/sse",
		headers: [{ key: "Authorization", value: "Bearer secret" }],
	};

	const view = render(
		<McpForm
			projectId="p1"
			name="GitHub MCP"
			onName={onName}
			config={config}
			setField={setField}
			readOnly={true}
			tools={[{ name: "create_issue", description: "Create an issue" }]}
		/>,
	);

	// URL input is disabled
	const urlInput = view.getByPlaceholderText("https://mcp.example.com/sse") as HTMLInputElement;
	expect(urlInput.disabled).toBe(true);

	// Name input is disabled
	const nameInput = view.getByPlaceholderText("e.g. GitHub MCP Server") as HTMLInputElement;
	expect(nameInput.disabled).toBe(true);

	// Header key input is disabled
	const headerKeyInput = view.getByPlaceholderText("Header name") as HTMLInputElement;
	expect(headerKeyInput.disabled).toBe(true);

	// Header value input is disabled
	const headerValueInput = view.getByPlaceholderText("Header value") as HTMLInputElement;
	expect(headerValueInput.disabled).toBe(true);

	// "Add header" button is not rendered
	expect(view.queryByRole("button", { name: "Add header" })).toBeNull();

	// "Remove header" button is not rendered
	expect(view.queryByLabelText("Remove header")).toBeNull();

	// Hint is rendered
	expect(view.getByText("Use app config references for secrets")).not.toBeNull();

	// Tools list is displayed
	expect(view.getByText("create_issue")).not.toBeNull();
	expect(view.getByText("Create an issue")).not.toBeNull();
});

test("mcp form is editable when readOnly is false", () => {
	const setField = mock();
	const onName = mock();
	const config = {
		url: "https://mcp.example.com/sse",
		headers: [{ key: "Authorization", value: "Bearer secret" }],
	};

	const view = render(
		<McpForm
			projectId="p1"
			name="GitHub MCP"
			onName={onName}
			config={config}
			setField={setField}
			readOnly={false}
		/>,
	);

	// Inputs are enabled
	const urlInput = view.getByPlaceholderText("https://mcp.example.com/sse") as HTMLInputElement;
	expect(urlInput.disabled).toBe(false);

	const nameInput = view.getByPlaceholderText("e.g. GitHub MCP Server") as HTMLInputElement;
	expect(nameInput.disabled).toBe(false);

	const headerKeyInput = view.getByPlaceholderText("Header name") as HTMLInputElement;
	expect(headerKeyInput.disabled).toBe(false);

	const headerValueInput = view.getByPlaceholderText("Header value") as HTMLInputElement;
	expect(headerValueInput.disabled).toBe(false);

	// "Add header" button is present
	expect(view.getByRole("button", { name: "Add header" })).not.toBeNull();

	// "Remove header" button is present
	expect(view.getByLabelText("Remove header")).not.toBeNull();
});
