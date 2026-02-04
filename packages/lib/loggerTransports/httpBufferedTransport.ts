import { Writable } from "stream";

interface HttpTransportOptions {
  url: string;
  headers?: Record<string, string>;
  flushInterval?: number;
  bufferSize?: number;
  logStore?: "loki" | "openobserve";
  labels?: Record<string, string>; // Required for Loki
}

export class HttpBufferedTransport extends Writable {
  private buffer: Array<string | [string, string]> = [];
  private bufferBytes: number = 0;
  private timer?: NodeJS.Timeout;
  private url: string;
  private headers: Record<string, string>;
  private flushInterval: number;
  private bufferSize: number;
  private logStore: "loki" | "openobserve";
  private labels: Record<string, string>;

  constructor(opts: HttpTransportOptions) {
    super({ objectMode: true });

    this.url = opts.url;
    this.headers = opts.headers ?? {};
    this.flushInterval = opts.flushInterval ?? 2000;
    this.bufferSize = opts.bufferSize ?? 1024;
    this.logStore = opts.logStore ?? "openobserve";
    this.labels = opts.labels ?? { job: "fluxify" };

    this.timer = setInterval(() => void this.flush(), this.flushInterval);
    this.timer.unref();
  }

  override _write(
    chunk: any,
    _encoding: string,
    callback: (err?: Error | null) => void,
  ) {
    const line =
      typeof chunk === "string" ? chunk.trim() : JSON.stringify(chunk);

    if (this.logStore === "loki") {
      // Loki requires [timestamp, message] tuples
      const timestamp = (Date.now() * 1_000_000).toString();
      this.buffer.push([timestamp, line]);
    } else {
      // OpenObserve uses plain strings
      this.buffer.push(line);
    }

    this.bufferBytes += Buffer.byteLength(line);

    if (this.bufferBytes >= this.bufferSize) {
      void this.flush();
    }

    callback();
  }

  async flush() {
    if (!this.buffer.length) return;

    let payload: string;
    let contentType: string;

    if (this.logStore === "loki") {
      // Loki format
      const lokiPayload = {
        streams: [
          {
            stream: this.labels,
            values: this.buffer as Array<[string, string]>,
          },
        ],
      };
      payload = JSON.stringify(lokiPayload);
      contentType = "application/json";
    } else {
      // OpenObserve format
      payload = (this.buffer as string[]).join("\n") + "\n";
      contentType = "application/x-ndjson";
    }

    const bufferedEntries = [...this.buffer];
    this.buffer = [];
    this.bufferBytes = 0;

    try {
      const res = await fetch(this.url, {
        method: "POST",
        headers: {
          "Content-Type": contentType,
          ...this.headers,
        },
        body: payload,
      });
    } catch (err) {
      console.error("HTTP log push failed:", err);
      // Requeue on failure
      this.buffer.unshift(...bufferedEntries);
      this.bufferBytes = bufferedEntries.reduce((acc, entry) => {
        const line = Array.isArray(entry) ? entry[1] : entry;
        return acc + Buffer.byteLength(line);
      }, 0);
    }
  }

  override _final(callback: (err?: Error | null) => void) {
    if (this.timer) clearInterval(this.timer);
    this.flush()
      .then(() => callback())
      .catch(callback);
  }
}
