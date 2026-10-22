import { expect, it } from "bun:test";
import { runBlock } from "@fluxify/sdk/testing";
import send from "./send";

type Sent = { to: string[]; subject: string; text?: string };

it("sends through the email group's client", async () => {
	const sent: Sent[] = [];
	const r = await runBlock(send, {
		params: {
			integration: "mail",
			to: ["ada@example.com"],
			subject: "Your order",
			text: "Thanks",
		},
		ctx: {
			integrations: {
				mail: {
					kind: "fluxify-examples/email",
					client: {
						async sendEmail(message: Sent) {
							sent.push(message);
							return {
								messageId: "1",
								accepted: message.to,
								rejected: [],
								response: "queued",
							};
						},
					},
				},
			},
		},
	});
	expect(r.error).toBeUndefined();
	expect(sent).toEqual([
		{ to: ["ada@example.com"], subject: "Your order", text: "Thanks" },
	]);
	expect(r.output).toMatchObject({ messageId: "1", accepted: ["ada@example.com"] });
});

it("refuses a message with no body", async () => {
	const r = await runBlock(send, {
		params: { integration: "mail", to: ["ada@example.com"], subject: "Your order" },
		ctx: {
			integrations: {
				mail: { kind: "fluxify-examples/email", client: { sendEmail: async () => ({}) } },
			},
		},
	});
	expect(r.error?.message).toBe("give a text body, an HTML body, or both");
});
