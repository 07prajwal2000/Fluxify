import { param } from "@fluxify/sdk/blocks";
import { integration } from "@fluxify/sdk/integrations";
import { createTransport, type SendMailOptions, type Transporter } from "nodemailer";

export type EmailMessage = {
	from?: string;
	to: string | string[];
	cc?: string | string[];
	bcc?: string | string[];
	replyTo?: string;
	subject: string;
	text?: string;
	html?: string;
	headers?: Record<string, string>;
};

export type SentEmail = {
	messageId: string;
	accepted: string[];
	rejected: string[];
	response: string;
	envelope?: { from?: string; to?: string[] };
};

export type EmailClient = {
	sendEmail(message: EmailMessage): Promise<SentEmail>;
};

const transports = new WeakMap<EmailClient, Transporter>();

const address = (value: unknown): string =>
	typeof value === "string"
		? value
		: value && typeof value === "object" && "address" in value
			? String((value as { address: unknown }).address)
			: String(value);

const addresses = (value: unknown): string[] =>
	(Array.isArray(value) ? value : [value]).map(address);

const envelopeOf = (value: unknown): SentEmail["envelope"] => {
	if (!value || typeof value !== "object") return undefined;
	const envelope = value as { from?: unknown; to?: unknown };
	return {
		...(typeof envelope.from === "string" ? { from: envelope.from } : {}),
		...(Array.isArray(envelope.to) ? { to: envelope.to.map(String) } : {}),
	};
};

export default integration({
	name: "fluxify-examples/integrations/smtp",
	label: "SMTP",
	description: "Sends email through an SMTP server.",
	icon: "./icons/email.svg",
	group: "email",
	variant: "smtp",
	docs: `Sends email through an SMTP server.

## When to use it
Use it as the connection the Send email block sends through: a company mail server, a relay, or a hosted mailbox.

## Connection
| Name | Required | Default |
| :--- | :--- | :--- |
| Host | Yes | |
| Port | Yes | 587 |
| Implicit TLS | Yes | off |
| Username | Yes | |
| Password | Yes | an App config key |

## How it behaves
- **Implicit TLS** on connects with TLS straight away, as port 465 needs. Off uses STARTTLS when the server offers it, as port 587 needs.
- The password is read from App config through the key this config names, so the value is never stored on the integration.
- **Test connection** opens a transport and asks the server to authenticate, without sending a message.`,
	config: {
		host: param.string({ label: "Host", required: true }),
		port: param.number({
			label: "Port",
			required: true,
			default: 587,
			min: 1,
			max: 65_535,
			integer: true,
		}),
		secure: param.boolean({
			label: "Implicit TLS",
			description: "On for port 465; off for STARTTLS on port 587.",
			default: false,
		}),
		username: param.string({ label: "Username", required: true }),
		password: param.secret({ label: "Password", required: true }),
	},
	async connect(config, ctx) {
		const transporter = createTransport({
			host: config.host,
			port: config.port,
			secure: config.secure,
			auth: { user: config.username, pass: ctx.getConfig(config.password) },
		});
		const client: EmailClient = {
			async sendEmail(message) {
				const info = await transporter.sendMail(message as SendMailOptions);
				const envelope = envelopeOf(info.envelope);
				return {
					messageId: String(info.messageId ?? ""),
					accepted: addresses(info.accepted ?? []),
					rejected: addresses(info.rejected ?? []),
					response: String(info.response ?? ""),
					...(envelope ? { envelope } : {}),
				};
			},
		};
		transports.set(client, transporter);
		return client;
	},
	async test(client) {
		const transporter = transports.get(client);
		if (!transporter) throw new Error("the SMTP transport is not available");
		await transporter.verify();
		return { success: true };
	},
	close(client) {
		transports.get(client)?.close();
		transports.delete(client);
	},
});
