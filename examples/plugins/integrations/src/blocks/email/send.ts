import { block, hint, param } from "@fluxify/sdk/blocks";
import type smtp from "../../integrations/smtp";
import type { EmailMessage } from "../../integrations/smtp";

const recipients = (values: unknown[] | undefined) => values?.map((value) => String(value));

export default block({
	name: "fluxify-examples/integrations/email/send",
	label: "Send email",
	description: "Sends an email through an SMTP integration.",
	icon: "./icons/email.svg",
	docs: `Sends an email through an SMTP integration.

## When to use it
Send a receipt, a password reset, a notification or a report from a route.

## Inputs
| Tab | Name | Required | Default |
| :--- | :--- | :--- | :--- |
| General | SMTP integration | Yes | |
| General | From | No | the server's default |
| General | To | Yes | |
| General | CC | No | none |
| General | BCC | No | none |
| General | Reply-to | No | none |
| General | Subject | Yes | |
| Body | Text body | No | |
| Body | HTML body | No | |
| Advanced | Headers | No | none |

## Outputs
The SMTP server's answer on \`source\`: \`{ messageId, accepted, rejected, response, envelope }\`.

## How it behaves
- Give a text body, an HTML body, or both; a run with neither fails.
- **To**, **CC** and **BCC** hold one address per row. Each can be a \`js:\` expression.
- The block fails when the server refuses the message, with its answer in the error.`,
	tabs: ["General", "Body", "Advanced"],
	// the group is filed under the plugin's scope: fluxify-examples/email
	permissions: { integrations: ["fluxify-examples/email"] },
	params: {
		integration: param.integration({
			label: "SMTP integration",
			kind: "fluxify-examples/email",
			required: true,
		}),
		from: param.string({
			label: "From",
			description: "Leave it empty to let the server pick its default sender.",
		}),
		to: param.array({ label: "To", of: "recipient", required: true, min: 1 }),
		cc: param.array({ label: "CC", of: "recipient" }),
		bcc: param.array({ label: "BCC", of: "recipient" }),
		replyTo: param.string({ label: "Reply-to" }),
		subject: param.string({ label: "Subject", required: true }),
		text: param.string({
			label: "Text body",
			description: "The plain-text body.",
			tab: "Body",
		}),
		html: param.string({
			label: "HTML body",
			description: "The HTML body, shown by mail clients that support it.",
			tab: "Body",
		}),
		bodyHint: hint(
			"Give a text body, an HTML body, or both. A mail client shows the HTML one and falls back to the text one.",
			{ tab: "Body", tone: "info" },
		),
		headers: param.keyValue({
			label: "Headers",
			tab: "Advanced",
			keys: { placeholder: "Header" },
		}),
	},
	async run({ params, ctx }) {
		if (!params.text && !params.html) throw new Error("give a text body, an HTML body, or both");
		// get<typeof smtp> is the client its connect() hands out, typed here
		const client = await ctx.integrations.get<typeof smtp>(params.integration);
		const headers = Object.fromEntries(
			Object.entries(params.headers ?? {}).map(([key, value]) => [
				key,
				typeof value === "string" ? value : JSON.stringify(value),
			]),
		);
		const message: EmailMessage = {
			...(params.from ? { from: params.from } : {}),
			to: recipients(params.to)!,
			...(params.cc?.length ? { cc: recipients(params.cc) } : {}),
			...(params.bcc?.length ? { bcc: recipients(params.bcc) } : {}),
			...(params.replyTo ? { replyTo: params.replyTo } : {}),
			subject: params.subject,
			...(params.text ? { text: params.text } : {}),
			...(params.html ? { html: params.html } : {}),
			...(Object.keys(headers).length ? { headers } : {}),
		};
		return { output: await client.sendEmail(message) };
	},
});
