import { Writable } from "stream";

interface HttpTransportOptions {
  url: string;
  headers?: Record<string, string>;
  flushInterval?: number;
  bufferSize?: number;
}

export class HttpBufferedTransport extends Writable {
  private buffer: string[] = [];
  private bufferBytes: number = 0;
  private timer?: NodeJS.Timeout;
  private url: string;
  private headers: Record<string, string>;
  private flushInterval: number;
  private bufferSize: number;

  constructor(opts: HttpTransportOptions) {
    super({ objectMode: true });

    this.url = opts.url;
    this.headers = opts.headers ?? {};
    this.flushInterval = opts.flushInterval ?? 2000;
    this.bufferSize = opts.bufferSize ?? 1024;

    this.timer = setInterval(() => void this.flush(), this.flushInterval);
    this.timer.unref(); // allow process exit
  }

  override _write(
    chunk: any,
    _encoding: string,
    callback: (err?: Error | null) => void,
  ) {
    const line =
      typeof chunk === "string" ? chunk.trim() : JSON.stringify(chunk);
    this.buffer.push(line);
    this.bufferBytes += Buffer.byteLength(line + "\n");

    if (this.bufferBytes >= this.bufferSize) {
      void this.flush();
    }

    callback();
  }

  async flush() {
    if (!this.buffer.length) return;

    const payload = this.buffer.join("\n") + "\n";
    this.buffer = [];
    this.bufferBytes = 0;

    try {
      await fetch(this.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-ndjson",
          ...this.headers,
        },
        body: payload,
      });
    } catch (err) {
      console.error("HTTP log push failed:", err);
      // Requeue on failure
      this.buffer.unshift(...payload.trim().split("\n"));
      this.bufferBytes = Buffer.byteLength(this.buffer.join("\n") + "\n");
    }
  }

  override _final(callback: (err?: Error | null) => void) {
    if (this.timer) clearInterval(this.timer);
    this.flush()
      .then(() => callback())
      .catch(callback);
  }
}
