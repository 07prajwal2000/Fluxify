import { logger } from "@fluxify/common";

export interface AbstractLogger {
	logInfo(value: any): void;
	logWarn(value: any): void;
	logError(value: any): void;
}

export class ConsoleLoggerProvider implements AbstractLogger {
	constructor(private readonly routeId?: string) {}

	logInfo(message: any, extra = {}): void {
		const mod = this.routeId ? `route:${this.routeId}` : "route";
		logger.info(message, mod, extra);
	}

	logWarn(message: any, extra = {}): void {
		const mod = this.routeId ? `route:${this.routeId}` : "route";
		logger.warn(message, mod, extra);
	}

	logError(message: any, extra = {}): void {
		const mod = this.routeId ? `route:${this.routeId}` : "route";
		logger.error(message, mod, extra);
	}
}

export class EmptyLoggerProvider implements AbstractLogger {
	logInfo(_: any): void {}
	logWarn(_: any): void {}
	logError(_: any): void {}
}
