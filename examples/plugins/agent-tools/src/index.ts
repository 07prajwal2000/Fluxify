import { plugin } from "@fluxify/sdk";

export default plugin({
	// permanent: a different name is a different plugin
	name: "fluxify-examples/agent-tools",
	url: "https://github.com/Fluxify-rest/Fluxify/tree/main/examples/plugins/agent-tools",
	description: "An agent block that calls the tool blocks wired to it.",
});
