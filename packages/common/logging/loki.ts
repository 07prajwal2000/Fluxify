import type winston from "winston";

export interface LokiLoggerOptions {
	host: string;
	basicAuth?: string;
	labels?: Record<string, string>;
}

export function createLokiLogger(options: LokiLoggerOptions): winston.Logger {
	if (typeof (globalThis as any).window !== "undefined") {
		return console as unknown as winston.Logger;
	}
	const winstonPkg = require("winston");
	const LokiTransport = require("winston-loki");

	return winstonPkg.createLogger({
		level: "info",
		format: winstonPkg.format.json(),
		transports: [
			new LokiTransport({
				host: options.host,
				basicAuth: options.basicAuth,
				labels: options.labels || {},
				batching: true,
				interval: 1,
				json: true,
			}),
		],
	});
}
