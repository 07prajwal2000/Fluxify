import { plugin } from "@fluxify/sdk";
import send from "./blocks/email/send";
import cache from "./integrations/cache";
import smtp from "./integrations/smtp";
import orders from "./triggers/orders";

export default plugin({
	// permanent: a different name is a different plugin
	name: "fluxify-examples/integrations",
	url: "https://github.com/Fluxify-rest/Fluxify/tree/main/examples/plugins/integrations",
	description: "A key-value variant and an email group, with a block that sends through it.",
	blocks: [send],
	triggers: [orders],
	integrations: [cache, smtp],
});
