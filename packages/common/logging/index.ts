import winston from "winston";
import { OpenTelemetryTransportV3 } from "@opentelemetry/winston-transport";
import { initializeOtlpLogger } from "./otlp/logs";

export interface LoggerConfig {
	serviceName?: string;
	level?: string;
	otlpEndpoint?: string;
	otlpHeaders?: Record<string, string>;
	useOtlp?: boolean;
}

export const logger = winston.createLogger({
	level: "info",
	transports: [
		new winston.transports.Console({
			format: winston.format.combine(
				winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
				winston.format.printf((info) => {
					return `${info.timestamp} [${info.level.toUpperCase()}]: ${info.message}`;
				}),
			),
		}),
	],
});

let isInitialized = false;

export function initializeLogger(config: LoggerConfig = {}): void {
	if (isInitialized) {
		return;
	}

	const serviceName = config.serviceName;
	const level = config.level || "info";
	const transports: winston.transport[] = [
		new winston.transports.Console({
			format: winston.format.combine(
				winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
				winston.format.printf((info) => {
					return `${info.timestamp} ${serviceName && `[${serviceName}]`} [${info.level.toUpperCase()}]: ${info.message}`;
				}),
			),
		}),
	];

	if (config.useOtlp && config.otlpEndpoint) {
		const headers = {
			...config.otlpHeaders,
		};

		// 1. Setup OpenTelemetry OTLP exporter and logger provider
		initializeOtlpLogger({
			url: config.otlpEndpoint,
			headers,
			serviceName: serviceName || "unknown service",
		});

		// 2. Add OpenTelemetry transport to Winston
		transports.push(new OpenTelemetryTransportV3());
	}

	// Reconfigure the Winston logger instance with new level and transports
	logger.configure({
		level,
		transports,
	});

	isInitialized = true;
}

export default logger;
