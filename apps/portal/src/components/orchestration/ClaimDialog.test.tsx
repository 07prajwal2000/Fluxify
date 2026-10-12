import { afterAll, afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

const { cleanup, render } = await import("@testing-library/react");
const { ClaimCard } = await import("./ClaimCard");
const { autoscalesFor, claimSubmit, ClaimDialog } = await import("./ClaimDialog");
const { NodeList } = await import("./NodeList");

type OrchestrationStatus = import("@/services/orchestration").OrchestrationStatus;
type ClaimView = import("@/services/orchestration").ClaimView;
type NodeView = import("@/services/orchestration").NodeView;

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

const status = (over: Partial<OrchestrationStatus> = {}): OrchestrationStatus => ({
	orchestrator: {
		alive: true,
		provider: "docker",
		holder: "host:1",
		at: "2026-10-12T10:00:00.000Z",
		reconcileIntervalMs: 5000,
		meta: {},
	},
	pool: { placed: 1, requested: 1, ceiling: 4 },
	entitlement: { maxReplicas: null, types: ["route", "workflow", "both"], perProject: true },
	canClaimRoutes: true,
	claims: [],
	sharedClaims: [],
	alarms: [],
	host: { at: null, nodes: [], missing: [] },
	...over,
});

const claim = (over: Partial<ClaimView> = {}): ClaimView => ({
	id: "c1",
	projectId: "p1",
	type: "workflow",
	env: "production",
	groupIds: [],
	groups: [],
	replicas: 2,
	maxReplicas: null,
	metadata: { resources: { cpu: 1, memoryMb: 1024 } },
	createdAt: "2026-10-12T10:00:00.000Z",
	nodes: [],
	...over,
});

const node = (over: Partial<NodeView> = {}): NodeView => ({
	id: "c1.0",
	claimId: "c1",
	replicaIndex: 0,
	projectId: "p1",
	type: "workflow",
	env: "production",
	groupIds: [],
	excludedGroups: [],
	state: "ready",
	reason: null,
	image: "fluxify-worker-compiled:alpha",
	containerId: "c1.0",
	live: true,
	serving: true,
	lastHeartbeatAt: "2026-10-12T10:00:00.000Z",
	observedAt: "2026-10-12T10:00:00.000Z",
	autoscaled: false,
	...over,
});

const dialog = (props: Partial<Parameters<typeof ClaimDialog>[0]> = {}) =>
	render(
		<ClaimDialog status={status()} isOpen onClose={() => {}} onSubmit={() => {}} {...props} />,
	);

test("a new claim opens on Production, and says what that means", () => {
	dialog();
	expect(document.body.textContent).toContain("Which environment?");
	// the picker's trigger reads the current answer, so the default is visible
	expect(document.body.textContent).toContain("Production");
	expect(document.body.textContent).toContain("Runs live traffic");
});

test("a development claim says it takes no licence slot and runs the dev paths", () => {
	dialog({ claim: claim({ env: "development" }) });
	expect(document.body.textContent).toContain("Development");
	expect(document.body.textContent).toContain("no licence slot");
	expect(document.body.textContent).toContain("/_/dev");
});

test("a development claim is offered no maximum copies, on a platform that autoscales", () => {
	dialog({
		status: status({
			orchestrator: { ...status().orchestrator, provider: "kubernetes" },
		}),
		claim: claim({ env: "development" }),
	});
	expect(document.body.textContent).toContain("Identical copies");
	expect(document.body.textContent).not.toContain("Maximum copies");
	expect(document.body.textContent).toContain("nothing to autoscale");
});

test("a production claim is offered one, on a platform that autoscales", () => {
	dialog({
		status: status({
			orchestrator: { ...status().orchestrator, provider: "kubernetes" },
		}),
		claim: claim({ env: "production" }),
	});
	expect(document.body.textContent).toContain("Minimum copies");
	expect(document.body.textContent).toContain("Maximum copies");
});

test("no maximum reaches the API for a development claim, whatever the dialog holds", () => {
	const common = { type: "workflow" as const, groupIds: ["g1"], replicas: 2, maxReplicas: 8 };
	const resources = { cpu: 1, memoryMb: 1024 };

	expect(claimSubmit({ ...common, env: "development", autoscales: true, resources })).toEqual({
		type: "workflow",
		env: "development",
		groupIds: ["g1"],
		replicas: 2,
		metadata: { resources },
	});
	expect(claimSubmit({ ...common, env: "production", autoscales: true, resources })).toMatchObject({
		env: "production",
		maxReplicas: 8,
	});
	// and a platform that never autoscales sends none either
	expect(
		claimSubmit({ ...common, env: "production", autoscales: false, resources }),
	).not.toHaveProperty("maxReplicas");
});

test("a development claim wears a Dev badge, and a production one does not", () => {
	const dev = render(<ClaimCard claim={claim({ env: "development" })} provider="docker" />);
	expect(dev.getByText("Dev")).toBeTruthy();
	expect(dev.getByText(/no licence slot/)).toBeTruthy();
	dev.unmount();

	const prod = render(<ClaimCard claim={claim()} provider="docker" />);
	expect(prod.queryByText("Dev")).toBeNull();
});

test("a development node wears one too, so every copy under the claim is marked", () => {
	const dev = render(<NodeList nodes={[node({ env: "development" })]} provider="docker" />);
	expect(dev.getByText("Dev")).toBeTruthy();
	dev.unmount();

	const prod = render(<NodeList nodes={[node()]} provider="docker" />);
	expect(prod.queryByText("Dev")).toBeNull();
});

test("the environment picker offers both, and a development claim keeps the maximum out", () => {
	// The rule both ends of the form follow: the picker (below) and the payload
	// (above). HeroUI's select list is a portal React Aria only opens on a real
	// press, so what is asserted here is the rule itself plus how the form
	// renders each answer — not the popover's own behaviour.
	expect(autoscalesFor("kubernetes", "production")).toBe(true);
	expect(autoscalesFor("kubernetes", "development")).toBe(false);
	expect(autoscalesFor("docker", "production")).toBe(false);

	render(
		<ClaimDialog
			status={status({
				orchestrator: { ...status().orchestrator, provider: "kubernetes" },
			})}
			claim={claim({ env: "development" })}
			isOpen
			onClose={() => {}}
			onSubmit={() => {}}
		/>,
	);
	expect(document.body.textContent).toContain("Development");
	expect(document.body.textContent).not.toContain("Maximum copies");
});
