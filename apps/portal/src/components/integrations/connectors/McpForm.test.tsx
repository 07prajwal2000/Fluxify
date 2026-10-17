import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ComponentProps } from "react";

try {
	GlobalRegistrator.register();
} catch {}

const realAppConfigSelector = { ...(await import("../AppConfigSelector")) };
mock.module("../AppConfigSelector", () => ({
	AppConfigSelector: ({ value, isDisabled, placeholder }: any) => (
		<input placeholder={placeholder} value={value} disabled={isDisabled} readOnly />
	),
}));

const { cleanup, fireEvent, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
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

function renderOAuthForm(over: Record<string, unknown> = {}) {
	const setField = mock();
	const props = {
		projectId: "p1",
		name: "GitHub MCP",
		onName: mock(),
		setField,
		config: { url: "https://mcp.example.com/sse", headers: [] as unknown[], auth: "oauth" },
		...over,
	};
	const view = render(
		<QueryClientProvider client={new QueryClient()}>
			<McpForm {...(props as unknown as ComponentProps<typeof McpForm>)} />
		</QueryClientProvider>,
	);
	return { view, setField };
}

test("authentication is a choice between headers and OAuth, headers by default", () => {
	const { view, setField } = renderOAuthForm({
		config: { url: "https://mcp.example.com/sse", headers: [] },
	});
	// headers: the editor, no sign in
	expect(view.getByRole("button", { name: "Add header" })).not.toBeNull();
	expect(view.queryByText("Sign in with OAuth")).toBeNull();
	fireEvent.click(view.getByRole("button", { name: "OAuth" }));
	expect(setField).toHaveBeenCalledWith("auth", "oauth");
});

test("OAuth replaces the headers with the sign in, saved first", () => {
	const { view, setField } = renderOAuthForm();
	expect(view.getByText("Sign in with OAuth")).not.toBeNull();
	expect(view.getByText("Save the integration first, then Connect.")).not.toBeNull();
	expect(view.queryByRole("button", { name: "Add header" })).toBeNull();
	fireEvent.click(view.getByRole("button", { name: "Headers" }));
	expect(setField).toHaveBeenCalledWith("auth", "headers");
});

test("a saved OAuth integration shows its status and Connect for an admin", () => {
	const { view } = renderOAuthForm({
		config: {
			url: "https://mcp.example.com/sse",
			headers: [],
			auth: "oauth",
			oauth: { connected: true, expiresAt: 1, scope: "math" },
		},
		oauth: { integrationId: "i1", env: "production", canConnect: true, saved: true },
	});
	expect(view.getByText("Connected")).not.toBeNull();
	expect(view.getByRole("button", { name: "Reconnect" })).not.toBeNull();
});

test("read-only: the choice is locked", () => {
	const { view } = renderOAuthForm({ readOnly: true });
	expect((view.getByRole("button", { name: "OAuth" }) as HTMLButtonElement).disabled).toBe(true);
	expect((view.getByRole("button", { name: "Headers" }) as HTMLButtonElement).disabled).toBe(true);
});
