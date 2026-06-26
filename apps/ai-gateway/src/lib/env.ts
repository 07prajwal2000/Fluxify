type LogLevel = "info" | "warn" | "error";
type EnvType = "development" | "production" | "testing" | "staging";

export const OTLP_ENDPOINT = process.env.OTLP_ENDPOINT!;
export const PG_URL = process.env.PG_URL!;
export const OTLP_AUTH_HEADER_NAME = process.env.OTLP_AUTH_HEADER_NAME!;
export const OTLP_AUTH_HEADER_VALUE = process.env.OTLP_AUTH_HEADER_VALUE!;
export const OTLP_SERVICE_NAME = process.env.OTLP_SERVICE_NAME!;
export const OTLP_LOGGER_ENABLED = process.env.OTLP_LOGGER_ENABLED!;
export const OTLP_LOGGER_LEVEL: LogLevel =
	(process.env.OTLP_LOGGER_LEVEL as LogLevel) || "info";
export const NODE_ENV: EnvType =
	(process.env.NODE_ENV as EnvType) || "development";
export const REDIS_HOST = process.env.REDIS_HOST!;
export const REDIS_PORT = process.env.REDIS_PORT!;
export const REDIS_USER = process.env.REDIS_USER!;
export const REDIS_PASS = process.env.REDIS_PASS!;
