import { expect, it } from "bun:test";
import { toIntegrationEntry } from "@fluxify/sdk/integrations";
import { runIntegration } from "@fluxify/sdk/testing";
import smtp from "./smtp";

const config = {
	host: "smtp.gmail.com",
	port: 587,
	secure: false,
	username: "ada@example.com",
	password: "SMTP_PASSWORD",
};

it("is an email/smtp variant with the password as its only secret", () => {
	const entry = toIntegrationEntry(smtp);
	expect(entry.group).toBe("fluxify-examples/email");
	expect(entry.variant).toBe("smtp");
	expect(entry.secretParams).toEqual(["password"]);
	expect(entry.hasTest).toBe(true);
});

it("requires the host, username and password", () => {
	expect(() => runIntegration(smtp, { config: {} })).toThrow("param 'host' is required");
	expect(() =>
		runIntegration(smtp, { config: { host: "smtp.gmail.com", port: 587 } }),
	).toThrow("param 'username' is required");
});

type Session = { buffer: string; inData: boolean; authPending: boolean };
type SmtpSocket = { write(data: string): unknown; end(): void };

/** a minimal plaintext SMTP server: EHLO, AUTH PLAIN, MAIL, RCPT, DATA, QUIT */
function smtpStub() {
	let auth = "";
	const sessions = new WeakMap<object, Session>();
	const line = (socket: SmtpSocket, session: Session, text: string) => {
		if (session.authPending) {
			session.authPending = false;
			auth = Buffer.from(text.trim(), "base64").toString();
			socket.write("235 2.7.0 Authentication successful\r\n");
			return;
		}
		if (session.inData) {
			if (text === ".") {
				session.inData = false;
				socket.write("250 2.0.0 Ok: queued\r\n");
			}
			return;
		}
		if (/^(EHLO|HELO)/i.test(text)) {
			socket.write("250-test\r\n250-AUTH PLAIN\r\n250 OK\r\n");
		} else if (/^AUTH PLAIN (.*)$/i.test(text)) {
			auth = Buffer.from(text.replace(/^AUTH PLAIN /i, "").trim(), "base64").toString();
			socket.write("235 2.7.0 Authentication successful\r\n");
		} else if (/^AUTH PLAIN$/i.test(text)) {
			session.authPending = true;
			socket.write("334 \r\n");
		} else if (/^(MAIL FROM|RCPT TO)/i.test(text)) {
			socket.write("250 OK\r\n");
		} else if (/^DATA$/i.test(text)) {
			session.inData = true;
			socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
		} else if (/^QUIT/i.test(text)) {
			socket.write("221 Bye\r\n");
			socket.end();
		} else {
			socket.write("250 OK\r\n");
		}
	};
	const server = Bun.listen({
		hostname: "127.0.0.1",
		port: 0,
		socket: {
			open(socket) {
				sessions.set(socket, { buffer: "", inData: false, authPending: false });
				socket.write("220 test ESMTP\r\n");
			},
			data(socket, data) {
				const session = sessions.get(socket);
				if (!session) return;
				session.buffer += data.toString();
				for (;;) {
					const end = session.buffer.indexOf("\r\n");
					if (end === -1) break;
					const current = session.buffer.slice(0, end);
					session.buffer = session.buffer.slice(end + 2);
					line(socket, session, current);
				}
			},
		},
	});
	return { server, port: server.port, auth: () => auth };
}

it("sends through a real transport, reading the password from app config", async () => {
	const stub = smtpStub();
	const run = runIntegration(smtp, {
		config: {
			host: "127.0.0.1",
			port: stub.port,
			secure: false,
			username: "ada@example.com",
			password: "SMTP_PASSWORD",
		},
		appConfig: { SMTP_PASSWORD: "app-password" },
	});
	try {
		const client = await run.client();
		const sent = await client.sendEmail({
			from: "shop@example.com",
			to: "ada@example.com",
			subject: "Your order",
			text: "Thanks",
		});
		expect(sent.accepted).toEqual(["ada@example.com"]);
		expect(sent.messageId).toBeTruthy();
		expect(stub.auth()).toBe("\0ada@example.com\0app-password");
	} finally {
		await run.close();
		stub.server.stop(true);
	}
});
