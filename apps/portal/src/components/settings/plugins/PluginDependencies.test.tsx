import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ReactNode } from "react";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register({ url: "http://localhost:5601/" });

// not `screen`: it stays bound to the document of whichever test file loaded RTL first
const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { NpmTab } = await import("./AddPluginTabs");
const { PluginDependencies } = await import("./PluginDependencies");
const { pluginsService } = await import("@/services/plugins");
const { plugin } = await import("./fixtures");

const resolveNpm = spyOn(pluginsService, "resolveNpm");
const addNpm = spyOn(pluginsService, "addNpm");
const dependencyPlan = spyOn(pluginsService, "dependencyPlan");
const installDependencies = spyOn(pluginsService, "installDependencies");

const SPEC = "@acme/sales@1.0.0";
const CRM = { name: "@other/crm", plugin: "other/crm", version: "1.2.0" };
const MAIL = { name: "@other/mail", plugin: "other/mail", version: "2.1.0", from: "2.0.0" };
const plan = (dependencies: object[]) => ({
	name: "@acme/sales",
	plugin: "acme/sales",
	version: "1.0.0",
	dependencies,
});

async function until<T>(check: () => T, timeout = 1500): Promise<T> {
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

const button = (name: string) =>
	[...document.querySelectorAll("button")].find(
		(b) => b.textContent?.trim() === name,
	) as HTMLButtonElement;
const press = async (name: string) => {
	const b = await until(() => {
		const found = button(name);
		if (!found) throw new Error(`no button ${name}`);
		return found;
	});
	await act(async () => void fireEvent.click(b));
};
const text = () => document.body.textContent ?? "";

beforeEach(() => {
	for (const s of [resolveNpm, addNpm, dependencyPlan, installDependencies]) s.mockReset();
	addNpm.mockResolvedValue(plugin({ name: "acme/sales" }));
});
afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

const wrap = (node: ReactNode) =>
	render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			{node}
		</QueryClientProvider>,
	);

async function typeSpec() {
	const onAdded = mock();
	wrap(<NpmTab projectId="p1" onAdded={onAdded} />);
	const input = document.querySelector("input") as HTMLInputElement;
	await act(async () => void fireEvent.change(input, { target: { value: SPEC } }));
	await press("Add");
	return onAdded;
}

test("lists the plugins an npm install brings along, and installs nothing before Install", async () => {
	resolveNpm.mockResolvedValue(plan([CRM, MAIL]) as never);
	const onAdded = await typeSpec();
	await until(() => expect(text()).toContain("needs 2 other plugins"));
	expect(resolveNpm).toHaveBeenCalledWith("p1", SPEC);
	expect(text()).toContain("@other/crm@1.2.0");
	expect(text()).toContain("New");
	expect(text()).toContain("@other/mail@2.1.0");
	expect(text()).toContain("Upgrade from 2.0.0");
	expect(addNpm).not.toHaveBeenCalled();

	await press("Install");
	await until(() => expect(onAdded).toHaveBeenCalled());
	expect(addNpm).toHaveBeenCalledWith("p1", SPEC);
});

test("Back returns to the form without installing", async () => {
	resolveNpm.mockResolvedValue(plan([CRM]) as never);
	await typeSpec();
	await until(() => expect(text()).toContain("needs another plugin"));
	await press("Back");
	await until(() => expect(button("Add")).toBeDefined());
	expect(addNpm).not.toHaveBeenCalled();
});

test("a plugin with nothing to bring along is added at once", async () => {
	resolveNpm.mockResolvedValue(plan([]) as never);
	const onAdded = await typeSpec();
	await until(() => expect(onAdded).toHaveBeenCalled());
	expect(addNpm).toHaveBeenCalledWith("p1", SPEC);
});

test("a conflict is shown as the server words it, and nothing is installed", async () => {
	resolveNpm.mockRejectedValue(
		new Error("acme/sales needs other/crm ^2.0.0, but x/other needs ^1.0.0"),
	);
	await typeSpec();
	await until(() => expect(text()).toContain("but x/other needs ^1.0.0"));
	expect(addNpm).not.toHaveBeenCalled();
});

const dependent = plugin({
	name: "acme/sales",
	approval: "pending",
	dependencies: {
		dependsOn: [
			{
				plugin: "other/crm",
				package: "@other/crm",
				range: "^1.0.0",
				installed: null,
				satisfied: false,
			},
			{
				plugin: "other/mail",
				package: "@other/mail",
				range: "^2.0.0",
				installed: { version: "2.0.0", approval: "approved" },
				satisfied: true,
			},
		],
		usedBy: [{ plugin: "acme/report", version: "0.3.0", range: "*", approval: "approved" }],
	},
});

test("the plugin page lists Depends on and Used by, and installs what is missing after showing it", async () => {
	dependencyPlan.mockResolvedValue({ dependencies: [CRM] });
	installDependencies.mockResolvedValue({ dependencies: [CRM] });
	wrap(<PluginDependencies projectId="p1" plugin={dependent} editable />);
	expect(text()).toContain("Not installed");
	expect(text()).toContain("2.0.0 approved");
	expect(text()).toContain("acme/report@0.3.0");

	await press("Install missing dependencies");
	await until(() => expect(text()).toContain("@other/crm@1.2.0"));
	expect(installDependencies).not.toHaveBeenCalled();
	await press("Install");
	await until(() => expect(installDependencies).toHaveBeenCalledWith("p1", "acme/sales"));
});

test("a viewer sees the lists but no install button", () => {
	wrap(<PluginDependencies projectId="p1" plugin={dependent} editable={false} />);
	expect(text()).toContain("other/crm");
	expect(button("Install missing dependencies")).toBeUndefined();
});
