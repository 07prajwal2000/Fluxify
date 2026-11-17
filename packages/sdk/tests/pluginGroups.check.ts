// Type tests for a dependency's group (#899): compiled by `bun run typecheck`, never run.
// A plugin's client type, declared by its build the way `declare module "@fluxify/sdk"` does
// in an author's project (`../index.js` is that module here).
import { integration } from "../integrations.js";

type CrmClient = { find(id: string): Promise<{ id: string }> };

declare module "../index.js" {
	interface PluginGroups {
		"dep/crm": CrmClient;
	}
}

const common = { label: "X", icon: "./x.svg", variant: "Mine", config: {} };
const client: CrmClient = { find: async (id) => ({ id }) };

function dependencyGroupChecks() {
	// the dependency's client: accepted
	integration({ ...common, name: "acme/t/crm", group: "dep/crm", connect: () => client });

	// @ts-expect-error a variant of dep/crm must hand out its CrmClient
	integration({ ...common, name: "acme/t/crm", group: "dep/crm", connect: () => ({ find: () => 1 }) });

	// @ts-expect-error missing a method is as wrong as the wrong shape
	integration({ ...common, name: "acme/t/crm", group: "dep/crm", connect: () => ({}) });

	// a group no plugin typed takes any client, as before
	integration({ ...common, name: "acme/t/crm", group: "dep/billing", connect: () => 42 });
}
void dependencyGroupChecks;
