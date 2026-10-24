/**
 * Ambient declarations fed to Monaco so JS expressions get autocomplete and
 * hover docs for the Fluxify runtime API. Mirrors what the engine injects into
 * the sandbox — keep the two in sync when the runtime gains a global.
 */
export const FLUXIFY_JS_GLOBALS = `
declare function getQueryParam(key: string): string | undefined;
declare function getRouteParam(key: string): string;
declare function getHeader(key: string): string;
declare function setHeader(key: string, value: string): void;
declare function setCookie(
  name: string,
  value: {
    value: string | number;
    domain: string;
    path: string;
    expiry: string;
    httpOnly: boolean;
    secure: boolean;
    samesite: "Lax" | "Strict" | "None";
  }
): void;
/**
 * The data this run was given: the request body on a route, the payload on a
 * workflow run.
 *
 * Its members come from the schema declared for it, registered separately and
 * merged into this interface. The index signature is what keeps an undeclared
 * body readable — with no schema, every property is still there, it just has
 * no type.
 */
declare interface FluxifyInputData {
  [key: string]: any;
}
/**
 * Nothing is declared here directly: the editor merges into one of these when
 * the open route buffers or pipes an octet-stream body, which switches the
 * return type of getRequestBody() below.
 */
declare interface FluxifyStreamMode {}
declare interface FluxifyBlobMode {}
/**
 * The web stream a pipe route hands over. Declared here because the editor's
 * TypeScript lib is ES2020 only, and the runtime is Bun rather than a DOM page.
 */
declare interface ReadableStream<R = any> {
  readonly locked: boolean;
  cancel(reason?: any): Promise<void>;
  getReader(): ReadableStreamDefaultReader<R>;
  pipeTo(
    destination: WritableStream<any>,
    options?: { preventClose?: boolean; preventAbort?: boolean; preventCancel?: boolean; signal?: AbortSignal }
  ): Promise<void>;
  pipeThrough<T>(
    transform: { readable: ReadableStream<T>; writable: WritableStream<any> },
    options?: { signal?: AbortSignal }
  ): ReadableStream<T>;
  tee(): [ReadableStream<R>, ReadableStream<R>];
  values(options?: { preventCancel?: boolean }): AsyncIterableIterator<R>;
  [Symbol.asyncIterator](): AsyncIterableIterator<R>;
}
declare interface ReadableStreamDefaultReader<R = any> {
  readonly closed: Promise<void>;
  cancel(reason?: any): Promise<void>;
  read(): Promise<{ done: boolean; value?: R }>;
  releaseLock(): void;
}
declare interface WritableStream<W = any> {
  readonly locked: boolean;
  abort(reason?: any): Promise<void>;
  close(): Promise<void>;
  getWriter(): WritableStreamDefaultWriter<W>;
}
declare interface WritableStreamDefaultWriter<W = any> {
  readonly closed: Promise<void>;
  readonly desiredSize: number | null;
  readonly ready: Promise<void>;
  abort(reason?: any): Promise<void>;
  close(): Promise<void>;
  write(chunk: W): Promise<void>;
  releaseLock(): void;
}
declare interface AbortSignal {
  readonly aborted: boolean;
  readonly reason: any;
  addEventListener(type: "abort", listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: "abort", listener: () => void): void;
}
/** the binary value a buffered octet-stream body arrives as */
declare interface Blob {
  readonly size: number;
  readonly type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
  bytes(): Promise<Uint8Array>;
  text(): Promise<string>;
  stream(): ReadableStream<Uint8Array>;
  slice(start?: number, end?: number, contentType?: string): Blob;
}
/** a file from a multipart upload */
declare interface File extends Blob {
  readonly name: string;
  readonly lastModified: number;
}
/**
 * get the data this run was given — an HTTP request body, or a workflow payload.
 *
 * In pipe-stream mode it is the raw ReadableStream<Uint8Array>; in buffered
 * binary mode it is a Blob; otherwise it has the shape its schema declares.
 */
declare function getRequestBody(): "stream" extends keyof FluxifyStreamMode
  ? ReadableStream<Uint8Array>
  : "blob" extends keyof FluxifyBlobMode
    ? Blob
    : FluxifyInputData;
/**
 * In an after middleware: the body of the reply the route (or a before
 * middleware) sent, even once \`input\` has been reshaped. \`null\` anywhere else.
 */
declare function getResponseBody(): any;
/**
 * In an after middleware: the status code of the reply the route (or a before
 * middleware) sent. \`null\` anywhere else.
 */
declare function getResponseStatus(): number | null;
/**
 * get the value of the app config
 * @param key app config key name
 */
declare function getConfig(key: string): string | number | boolean;
declare const httpRequestMethod: string;
declare const httpRequestRoute: string;
/**
 * run a SQL query inside the DB Native block (PostgreSQL, MySQL). On MongoDB use db instead
 * @param query SQL query. Use $1, $2 placeholders for values (MySQL also takes ?)
 * @param params values for the placeholders, in order. Never build the query string from user input
 * @returns the result rows
 * @example const users = await dbQuery("SELECT * FROM users WHERE id = $1", [id]);
 */
declare function dbQuery(query: string, params?: unknown[]): Promise<any[]>;
/**
 * Declared empty; the editor merges the previous block's output type into it
 * as \`value\` (see blockInputTypes.ts). Until it does, \`input\` is \`any\`.
 */
declare interface FluxifyBlockInput {}
/** The output of the previous block */
declare const input: "value" extends keyof FluxifyBlockInput ? FluxifyBlockInput["value"] : any;
/** One event a trigger collected, with what the source said about it. */
declare interface FluxifyTriggerEvent {
  /** The event's payload. */
  data: any;
  meta: {
    /** The source's own id for this event — use it to skip a duplicate. */
    id?: string;
    receivedAt?: string;
    source?: string;
    [key: string]: any;
  };
}
/**
 * What started this run.
 *
 * trigger.data is ALWAYS an array, even when a single event arrived, so a
 * graph reads a batch of one and a batch of five hundred the same way. Use
 * "input" when you only ever expect one event — at size 1 it is that event's
 * payload, unwrapped.
 */
declare const trigger: {
  kind: "route" | "job" | "workflow" | "cron" | "trigger";
  /** Where the work came from: "http", "internal", "schedule", "kafka", "nats" and so on. */
  source: string;
  /** Whether the caller waits for the answer. */
  reply: "sync" | "async";
  id?: string;
  data: FluxifyTriggerEvent[];
  meta: {
    batchId: string;
    /** How many events are in trigger.data. */
    size: number;
    firstReceivedAt?: string;
    lastReceivedAt?: string;
    /** 1 on the first run of this batch, counting up on each retry. */
    attempt?: number;
  };
  /** Queue triggers only (Kafka, NATS, SQS, Redis Streams, RabbitMQ): the source this batch was read from. */
  connection?: {
    /**
     * The underlying client, for what the helpers below do not cover.
     * Kafka: a @platformatic/kafka Consumer. NATS: an @nats-io/nats-core NatsConnection.
     * Redis Streams: an ioredis Redis. RabbitMQ: the consuming amqplib Channel
     * (ack, nack, reject, cancel, close and prefetch throw, use commit and moveToDLQ).
     * Fluxify owns it: closing, pausing or re-subscribing it can stall the
     * trigger until the worker restarts. Use with care.
     */
    raw: any;
    /** Mark the batch done. Needed only when the trigger commits from the workflow. */
    commit(): Promise<void>;
    /** Copy the batch to the integration's dead-letter topic. */
    moveToDLQ(error?: any): Promise<void>;
    /** Messages still waiting to be read, or null when unknown. */
    lag(): Promise<number | null>;
  };
};
declare const logger: {
  logInfo(value: any): void;
  logWarn(value: any): void;
  logError(value: any): void;
};
declare const jwt: {
  sign(payload: object, secretKey: string, options?: object): string;
  verify(
    token: string,
    secretKey: string,
    options?: object,
  ): { success: boolean; payload: Record<string, string> | null };
  decode(token: string, options?: object): Record<string, string> | null;
};
declare type HttpHeaders = Record<string, string>;

declare interface AxiosResponse<T = any> {
  data: T;
  status: number;
  statusText: string;
  headers: any;
  config: any;
}

declare interface AxiosInstance {
  get<T = any>(url: string, config?: any): Promise<AxiosResponse<T>>;
  post<T = any>(url: string, data?: any, config?: any): Promise<AxiosResponse<T>>;
  put<T = any>(url: string, data?: any, config?: any): Promise<AxiosResponse<T>>;
  delete<T = any>(url: string, config?: any): Promise<AxiosResponse<T>>;
  patch<T = any>(url: string, config?: any): Promise<AxiosResponse<T>>;
}

declare class HttpClient {
  constructor();
  get<T = any>(url: string, headers?: HttpHeaders): Promise<AxiosResponse<T>>;
  post<T = any>(url: string, data?: any, headers?: HttpHeaders): Promise<AxiosResponse<T>>;
  put<T = any>(url: string, data?: any, headers?: HttpHeaders): Promise<AxiosResponse<T>>;
  delete<T = any>(url: string, headers?: HttpHeaders): Promise<AxiosResponse<T>>;
  patch<T = any>(url: string, data?: any, headers?: HttpHeaders): Promise<AxiosResponse<T>>;
}

declare const httpClient: HttpClient;
`;
