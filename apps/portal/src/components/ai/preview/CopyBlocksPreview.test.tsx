import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ToolPart } from "../agentMessages";

GlobalRegistrator.register();

class Observer {
	observe() {}
	unobserve() {}
	disconnect() {}
}
Object.assign(globalThis, { ResizeObserver: Observer });
Object.assign(globalThis, {
	DOMMatrixReadOnly: class {
		m22 = 1;
	},
});

const router = await import("@tanstack/react-router");
mock.module("@tanstack/react-router", () => ({
	...router,
	useParams: () => ({ projectId: "p1" }),
	useMatch: () => undefined,
	useNavigate: () => () => {},
	useRouter: () => ({}),
	Link: ({ to, children, ...rest }: any) => (
		<a href={to} {...rest}>
			{children}
		</a>
	),
}));

const { act, cleanup, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { ToolRow } = await import("../ToolRow");
const { ToolBody } = await import("./ToolBody");
const { copyBlocksHeader } = await import("./toolHeader");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

async function until<T>(check: () => T, timeout = 2000): Promise<T> {
	const end = Date.now() + timeout;
	for (;;) {
		try {
			return check();
		} catch (e) {
			if (Date.now() > end) throw e;
			await act(() => new Promise((r) => setTimeout(r, 20)));
		}
	}
}

function showBody(tool: Partial<ToolPart>, asking = false) {
	return render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<ToolBody
				tool={{ type: "tool", id: "t1", name: "copy_blocks", input: {}, ...tool }}
				asking={asking}
			/>
		</QueryClientProvider>,
	);
}

function showRow(tool: Partial<ToolPart>, waiting = false, running = false) {
	return render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<ToolRow
				tool={{ type: "tool", id: "t1", name: "copy_blocks", input: {}, ...tool }}
				waiting={waiting}
				running={running}
			/>
		</QueryClientProvider>,
	);
}

test("copy_blocks header formatting: builds the single summary line for done and asking states", () => {
	const doneTool: ToolPart = {
		type: "tool",
		id: "t1",
		name: "copy_blocks",
		input: {
			from: { kind: "route", id: "r1" },
			fromName: "Create order",
			to: "__new_sandbox__",
			keys: ["b1", "b2", "b3"],
		},
		output: {
			target: { kind: "sandbox", id: "s1", name: "Create order sandbox" },
			keys: { b1: "b1_copy", b2: "b2_copy", b3: "b3_copy" },
		},
	};

	expect(copyBlocksHeader(doneTool, false)).toBe(
		"Copied 3 blocks from Create order (route) → Create order sandbox (new sandbox)",
	);

	const askingTool: ToolPart = {
		...doneTool,
		output: undefined,
	};

	expect(copyBlocksHeader(askingTool, true)).toBe(
		"Copy 3 blocks from Create order (route) → Create order sandbox (new sandbox)",
	);
});

test("ToolRow renders copy_blocks header in accordion summary", () => {
	const tool: ToolPart = {
		type: "tool",
		id: "t1",
		name: "copy_blocks",
		input: {
			from: { kind: "route", id: "r1" },
			fromName: "Create order",
			to: "__new_sandbox__",
			keys: ["b1", "b2", "b3"],
		},
		output: {
			target: { kind: "sandbox", id: "s1", name: "Create order sandbox" },
			keys: { b1: "b1_copy", b2: "b2_copy", b3: "b3_copy" },
		},
	};

	const view = showRow(tool);
	const summary = view.container.querySelector("summary");
	expect(summary?.textContent).toContain(
		"Copied 3 blocks from Create order (route) → Create order sandbox (new sandbox)",
	);
});

test("CopyBlocksPreview body: renders key mapping, warnings, target open link, and diff", async () => {
	const tool: Partial<ToolPart> = {
		name: "copy_blocks",
		input: {
			from: { kind: "route", id: "r1" },
			fromName: "Create order",
			to: "__new_sandbox__",
			keys: ["b1", "b2"],
		},
		output: {
			target: { kind: "sandbox", id: "s1", name: "Create order sandbox" },
			keys: { b1: "b1_copy", b2: "b2_copy" },
			warnings: ["The route's middlewares are not copied: they are route settings, not blocks."],
			issues: [{ severity: "warning", message: "Block b2 has no outputs connected" }],
		},
	};

	const view = showBody(tool);
	await until(() => expect(view.container.textContent).toContain("Create order sandbox"));

	// Target link
	const openLink = view.container.querySelector('a[href="/p1/sandbox-canvas/s1"]');
	expect(openLink).not.toBeNull();
	expect(openLink?.textContent).toContain("Open");

	// Key mapping section
	expect(view.getByLabelText("Key mapping").textContent).toContain("b1 → b1_copy");
	expect(view.getByLabelText("Key mapping").textContent).toContain("b2 → b2_copy");

	// Warnings
	expect(view.container.textContent).toContain(
		"The route's middlewares are not copied: they are route settings, not blocks.",
	);
	expect(view.container.textContent).toContain("Block b2 has no outputs connected");

	// Diff view has touched blocks
	expect(view.container.textContent).toContain("b1_copy");
	expect(view.container.textContent).toContain("b2_copy");
});

test("CopyBlocksPreview pending approval: shows what will be copied", async () => {
	const tool: Partial<ToolPart> = {
		name: "copy_blocks",
		input: {
			from: { kind: "route", id: "r1" },
			fromName: "Create order",
			to: "__new_sandbox__",
			keys: ["b1", "b2", "b3"],
		},
	};

	const view = showBody(tool, true);
	await until(() => expect(view.container.textContent).toContain("This action will copy"));
	expect(view.container.textContent).toContain("3 block(s) to Create order sandbox");
});
