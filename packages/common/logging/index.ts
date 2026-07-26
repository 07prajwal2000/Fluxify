import type winston from "winston";
import { OpenTelemetryTransportV3 } from "@opentelemetry/winston-transport";
import { createOtlpLoggerProvider, initializeOtlpLogger } from "./otlp/logs";
export { createLokiLogger } from "./loki";

export interface LoggerConfig {
	serviceName?: string;
	appName?: string;
	level?: string;
	otlpEndpoint?: string;
	otlpHeaders?: Record<string, string>;
	useOtlp?: boolean;
}

let currentAppName = "fluxify";

function getCallerFileName(): string {
	const err = new Error();
	const stackStr = err.stack || "";
	const lines = stackStr.split("\n");

	for (const line of lines) {
		const normalized = line.replace(/\\/g, "/");
		if (
			normalized.includes(".ts") ||
			normalized.includes(".js") ||
			normalized.includes(".cjs") ||
			normalized.includes(".mjs")
		) {
			if (
				!normalized.includes("packages/common/logging/index") &&
				!normalized.includes("node_modules") &&
				!normalized.includes("node:") &&
				!normalized.includes("winston") &&
				!normalized.includes("bun:")
			) {
				const match = normalized.match(/([a-zA-Z0-9_\-\.]+)\.(?:ts|js|cjs|mjs)/);
				if (match && match[1]) {
					return match[1];
				}
			}
		}
	}

	return "unknown";
}

const isBrowser = typeof (globalThis as any).window !== "undefined";

let winstonPkg: typeof winston | undefined;
if (!isBrowser) {
	try {
		winstonPkg = require("winston");
	} catch {
		// browser or environment without winston
	}
}

const createConsoleFormat = () => {
	if (!winstonPkg) return undefined;
	return winstonPkg.format.combine(
		winstonPkg.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
		winstonPkg.format.printf((info) => {
			const { timestamp, level, message, module: mod, service, appName, ...meta } = info;
			const metaStr = Object.keys(meta).length
				? ` ${JSON.stringify(meta)}`
				: "";
			const app = appName || currentAppName || "fluxify";
			const moduleName = mod || "unknown";
			return `${timestamp} [${app}] [${level.toUpperCase()}] [${moduleName}] ${message}${metaStr}`;
		}),
	);
};

const baseLogger = !isBrowser && winstonPkg
	? winstonPkg.createLogger({
			level: "info",
			transports: [
				new winstonPkg.transports.Console({
					format: createConsoleFormat(),
				}),
			],
		})
	: (console as unknown as winston.Logger);

function dispatchLog(level: string, message: any, moduleOrMeta?: any, meta?: any) {
	if (isBrowser) {
		const modStr = typeof moduleOrMeta === "string" ? `[${moduleOrMeta}] ` : "";
		const fn = (console as any)[level] || console.log;
		fn(`${modStr}${message}`, meta || "");
		return;
	}

	let moduleName: string | undefined;
	let metaObj: Record<string, any> = {};
	let cleanMessage = message;

	if (typeof message === "string") {
		const prefixMatch = message.match(/^\[([A-Za-z0-9_\-\s\.:]+)\]\s*(.*)$/);
		if (prefixMatch) {
			const prefixModule = prefixMatch[1];
			const restMsg = prefixMatch[2];
			if (restMsg) {
				cleanMessage = restMsg;
			} else {
				cleanMessage = prefixModule;
			}
			moduleName = prefixModule;
		}
	}

	if (typeof moduleOrMeta === "string") {
		moduleName = moduleOrMeta;
		if (meta && typeof meta === "object" && !Array.isArray(meta)) {
			metaObj = meta;
		}
	} else if (moduleOrMeta instanceof Error) {
		metaObj = { error: moduleOrMeta.message, stack: moduleOrMeta.stack };
	} else if (moduleOrMeta && typeof moduleOrMeta === "object" && !Array.isArray(moduleOrMeta)) {
		if (typeof moduleOrMeta.module === "string") {
			moduleName = moduleOrMeta.module;
			const { module: _, ...rest } = moduleOrMeta;
			metaObj = rest;
		} else {
			metaObj = moduleOrMeta;
		}
	} else if (moduleOrMeta !== undefined && moduleOrMeta !== null) {
		metaObj = { details: moduleOrMeta };
	}

	if (!moduleName) {
		moduleName = getCallerFileName();
	}

	const formattedMessage = typeof cleanMessage === "string" ? cleanMessage : JSON.stringify(cleanMessage);

	baseLogger.log({
		level,
		message: formattedMessage,
		module: moduleName,
		...metaObj,
	});
}

export interface CustomLogMethod {
	(message: any, moduleOrMeta?: any, meta?: any): void;
}

export type StructuredLogger = Omit<winston.Logger, "info" | "warn" | "error" | "debug" | "log"> & {
	info: CustomLogMethod;
	warn: CustomLogMethod;
	error: CustomLogMethod;
	debug: CustomLogMethod;
	log: (level: string, message: any, moduleOrMeta?: any, meta?: any) => void;
};

export const logger = new Proxy(baseLogger, {
	get(target, prop, receiver) {
		if (prop === "info") return (msg: any, mod?: any, meta?: any) => dispatchLog("info", msg, mod, meta);
		if (prop === "warn") return (msg: any, mod?: any, meta?: any) => dispatchLog("warn", msg, mod, meta);
		if (prop === "error") return (msg: any, mod?: any, meta?: any) => dispatchLog("error", msg, mod, meta);
		if (prop === "debug") return (msg: any, mod?: any, meta?: any) => dispatchLog("debug", msg, mod, meta);
		if (prop === "log") return (level: string, msg: any, mod?: any, meta?: any) => dispatchLog(level, msg, mod, meta);

		const val = Reflect.get(target, prop, receiver);
		return typeof val === "function" ? val.bind(target) : val;
	},
}) as unknown as StructuredLogger;

let isInitialized = false;

export function initializeLogger(config: LoggerConfig = {}): void {
	if (isInitialized) {
		return;
	}

	const serviceName = config.appName || config.serviceName;
	if (serviceName) {
		currentAppName = serviceName;
	}
	const level = config.level || "info";
	const transports: winston.transport[] = winstonPkg
		? [
				new winstonPkg.transports.Console({
					format: createConsoleFormat(),
				}),
			]
		: [];

	if (config.useOtlp && config.otlpEndpoint) {
		const headers = {
			...config.otlpHeaders,
		};

		// 1. Setup OpenTelemetry OTLP exporter and logger provider
		initializeOtlpLogger({
			url: config.otlpEndpoint,
			headers,
			serviceName: serviceName || "fluxify",
		});

		// 2. Add OpenTelemetry transport to Winston
		transports.push(new OpenTelemetryTransportV3());
	}

	// Reconfigure the Winston logger instance with new level and transports
	if (baseLogger && typeof (baseLogger as any).configure === "function") {
		(baseLogger as any).configure({
			level,
			transports,
		});
	}

	isInitialized = true;
}

export default logger;
export { createOtlpLoggerProvider };
export type { LoggerProvider } from "@opentelemetry/sdk-logs";
export type { Logger } from "@opentelemetry/api-logs";