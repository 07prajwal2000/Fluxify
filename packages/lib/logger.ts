import pino from "pino";

export abstract class AbstractLogger {
  abstract info(value: any): void;
  abstract warn(value: any): void;
  abstract error(value: any): void;
}

export class ConsoleLoggerProvider extends AbstractLogger {
  constructor(private readonly routeId?: string) {
    super();
  }

  info(message: any): void {
    console.log(`[INFO] [ROUTE: ${this.routeId}]`, message);
  }

  warn(message: any): void {
    console.log(`[WARN] [ROUTE: ${this.routeId}]`, message);
  }

  error(message: string): void {
    console.log(`[ERROR] [ROUTE: ${this.routeId}]`, message);
  }
}
export class EmptyLoggerProvider extends AbstractLogger {
  info(_: any): void {}
  warn(_: any): void {}
  error(_: any): void {}
}
/*
 * Use HttpBufferedTransport for OTLP log exports with ND-JSON format
 */
export class PinoHttpProvider extends AbstractLogger {
  constructor(private readonly pinoLogger: pino.Logger) {
    super();
  }
  error(value: any): void {
    this.pinoLogger.error(value);
  }
  info(value: any): void {
    this.pinoLogger.info(value);
  }
  warn(value: any): void {
    this.pinoLogger.warn(value);
  }
}
