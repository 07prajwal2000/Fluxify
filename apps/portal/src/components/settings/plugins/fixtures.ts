import type { Plugin, PluginUpgradeDiff } from "@/services/plugins";

const block = {
	name: "acme/slack/messages/post",
	label: "Post message",
	shape: "square",
	invoke: ["sync"],
	permissions: { integrations: ["kv"] },
	params: {},
	handles: { in: ["target"], out: ["success", "failure"], body: [] },
	deprecated: null,
};

/** an approved plugin, for the specs of this folder */
export const plugin = (over: Partial<Plugin> = {}): Plugin => ({
	id: "pl1",
	projectId: "p1",
	name: "acme/slack",
	version: "1.0.0",
	source: "npm",
	location: "@acme/fluxify-slack@1.0.0",
	integrity: "sha512-abc",
	url: "https://example.com/slack",
	sdkRange: ">=2026.10.0",
	manifest: { name: "acme/slack", blocks: { [block.name]: block } },
	approval: "approved",
	approvedBy: "u1",
	approvedAt: "2026-10-20T10:00:00.000Z",
	permissions: { integrations: ["kv"], appconfig: false },
	live: null,
	devEnabled: true,
	prodEnabled: false,
	status: "ok",
	lastError: null,
	scannedAt: null,
	createdAt: "2026-10-20T10:00:00.000Z",
	updatedAt: "2026-10-20T10:00:00.000Z",
	...over,
});

export const emptyDiff: PluginUpgradeDiff = {
	addedBlocks: [],
	removedBlocks: [],
	removedParams: [],
	removedHandles: [],
	changedInvoke: [],
	changedVariants: [],
	changedHandlesOrShape: [],
	addedPermissions: { integrations: [], appconfig: false },
	deprecations: [],
	addedIntegrations: [],
	removedIntegrations: [],
	changedIntegrations: [],
	addedTriggers: [],
	removedTriggers: [],
	changedTriggers: [],
	blocking: false,
	blockers: [],
};

/** an upgrade waiting on 1.1.0, with 1.0.0 still serving */
export const upgrading = (): Plugin =>
	plugin({
		version: "1.1.0",
		integrity: "sha512-new",
		approval: "pending",
		permissions: null,
		live: {
			version: "1.0.0",
			integrity: "sha512-abc",
			source: "npm",
			location: "@acme/fluxify-slack@1.0.0",
			manifest: plugin().manifest as never,
			permissions: { integrations: ["kv"], appconfig: false },
		},
	});
