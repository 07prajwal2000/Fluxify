import type { BlockDefinition, BodyOf, MultiName, OutName, SingleName } from "../block.js";
import type {
	BlockContext,
	BlockVars,
	DbAdapter,
	HttpClient,
	KvAdapter,
	QueueProducer,
} from "../context.js";
import { type Handles, toHandleSpec } from "../handles.js";
import type { AnyIntegration } from "../integration.js";
import { parseIntegrationKind } from "../integrations/variants.js";
import type { Params, ParamValue } from "../params.js";
import type { InvokeMode } from "../reserved.js";
import {
	type BodyHandles,
	createExecuteHandle,
	type ExecuteHandle,
	grantContext,
	type IntegrationSource,
	invokeError,
	type RunOutcome,
	routeResult,
} from "../runtime/contract.js";
import { createSpan, leasePool, type SpanRecord } from "../runtime/ctx.js";
import { openVariant } from "../runtime/integration.js";
import { setRaw } from "../runtime/raw.js";
import { evaluateParams } from "./evaluate.js";
import {
	type FakeSse,
	fakeSse,
	type LogEntry,
	memoryKv,
	memoryQueue,
	notStubbed,
	recordingLogger,
	type TestPool,
	testPool,
	unstubbedHttp,
} from "./fakes.js";
import { prepareIntegration, type RunIntegrationOptions } from "./runIntegration.js";

type Stub = (input: unknown) => unknown;
/** one branch of an `allowMultiple` handle; `id` defaults to `label` */
export type BranchStub = { label: string; id?: string; run: Stub };

/** what each body handle's chain does: a function, or the branches of an `allowMultiple` one */
export type HandleStubs<H> = [BodyOf<H>] extends [never]
	? { [name: string]: never }
	: { [N in SingleName<BodyOf<H>>]?: Stub } & {
			[N in MultiName<BodyOf<H>>]?: readonly BranchStub[];
		};

/** params as the canvas hands them over: required ones present, defaulted ones optional */
export type InputParams<P extends Params> = {
	-readonly [K in keyof P as P[K] extends { required: true } ? K : never]: ParamValue<P[K]>;
} & {
	-readonly [K in keyof P as P[K] extends { required: true } ? never : K]?: ParamValue<P[K]>;
};

/** `ctx` fakes; every one can be replaced */
export type TestContext = {
	projectId?: string;
	route?: string;
	apiId?: string;
	/** merged into `ctx.vars`: the run's variables, or request helpers like `getHeader` */
	vars?: Partial<BlockVars>;
	/** what `ctx.kvFactory.getKvAdapter(...)` returns; default `memoryKv()` */
	kv?: KvAdapter;
	/** what `ctx.queueFactory.getProducer(...)` returns; default `memoryQueue()` */
	queue?: QueueProducer;
	/** what `ctx.dbFactory.getDbAdapter(...)` returns; throws `not stubbed` when absent */
	db?: DbAdapter;
	/** `ctx.httpClient` and `ctx.vars.httpClient`; throws `not stubbed` when absent */
	http?: HttpClient;
	/** app config read by `ctx.vars.getConfig`; throws `not stubbed` when absent */
	config?: Record<string, string | number | boolean>;
	/**
	 * What `ctx.integrations.get(id)` returns, by id: a prebuilt `client` of
	 * `kind` (`database`, `database/PostgreSQL`, `acme/store`), with the `raw`
	 * `connection(id)` hands out (`kind` names its variant), or a real
	 * `integration(...)` with its config, connected (and pooled by its `poolKey`)
	 * the way a worker does. The kind must be granted by the block's
	 * `permissions.integrations`; an id not listed here is unknown.
	 */
	integrations?: Record<string, FakeIntegration>;
	/** the pooled clients; share one `testPool()` across runs to see reuse. Default: fresh per run */
	pool?: TestPool;
	/** `ctx.sse`; pass a `fakeSse({ onSend })` to disconnect mid-stream. Default: a fresh `fakeSse()` */
	sse?: FakeSse;
};

type Common<H> = {
	input?: unknown;
	/** how the canvas calls the block; default `sync`. Rejected like the compiler would */
	invoke?: InvokeMode;
	ctx?: TestContext;
	handles?: HandleStubs<H>;
	/**
	 * Keep the run's lifetime open after `run` returns, as when later blocks of
	 * the route still run, so closures over `executeHandle` (an agent's tools)
	 * still work. It ends on `end()`.
	 */
	keepAlive?: boolean;
};
export type RunBlockOptions<P extends Params, H> = Common<H> &
	({} extends InputParams<P> ? { params?: InputParams<P> } : { params: InputParams<P> });

export type HandleCall = {
	handle: string;
	/** the branch's label, on an `allowMultiple` handle */
	branch?: string;
	input: unknown;
	result?: unknown;
	error?: unknown;
};

export type RunBlockResult<H> = {
	/** the output handle the run leaves by; undefined for a terminal block and a failed run */
	handle?: OutName<H>;
	/** what the next block gets: `run`'s output, or the error message on `failure` */
	output: unknown;
	/** what `run` threw (routed to `failure` when `handle` is set), or why the run failed */
	error?: Error;
	spans: SpanRecord[];
	logs: LogEntry[];
	handleCalls: HandleCall[];
	/** the run's `ctx.sse`: events sent, handles closed */
	sse: FakeSse;
	/** ends the run, then calls `executeHandle`: rejects the way a late call does */
	callAfterEnd(handle: string, input?: unknown, options?: { branch: string }): Promise<unknown>;
	/** ends a `keepAlive` run */
	end(): void;
};

const asError = (e: unknown) => (e instanceof Error ? e : new Error(String(e)));

function bodyHandles(
	type: string,
	body: { name: string; allowMultiple?: boolean }[],
	stubs: object,
	calls: HandleCall[],
) {
	const known = new Set(body.map((b) => b.name));
	for (const name of Object.keys(stubs))
		if (!known.has(name))
			throw new Error(
				`Block ${type} has no body handle '${name}'; body handles: ${[...known].join(", ") || "none"}`,
			);
	const traced =
		(handle: string, branch: string | undefined, stub: Stub) => async (input: unknown) => {
			const call: HandleCall = { handle, ...(branch === undefined ? {} : { branch }), input };
			calls.push(call);
			try {
				call.result = await stub(input);
				return call.result;
			} catch (error) {
				call.error = error;
				throw error;
			}
		};
	const handles: BodyHandles = {};
	for (const { name, allowMultiple } of body) {
		const stub = (stubs as Record<string, unknown>)[name];
		if (stub !== undefined && typeof stub !== (allowMultiple ? "object" : "function"))
			throw new Error(
				`handle '${name}' takes ${allowMultiple ? "an array of { label, run }" : "a function"}`,
			);
		const branches = allowMultiple
			? ((stub ?? []) as BranchStub[]).map((b) => ({
					id: b.id ?? b.label,
					label: b.label,
					run: traced(name, b.label, b.run),
				}))
			: stub
				? [{ id: name, label: name, run: traced(name, undefined, stub as Stub) }]
				: [];
		handles[name] = { multiple: !!allowMultiple, branches };
	}
	return handles;
}

export type FakeIntegration =
	| {
			/** `database`, `kv/Redis`, `acme/store`: name the variant to give `connection` one */
			kind: string;
			client: unknown;
			/** what `connection(id).raw` is: the variant's own client (an ioredis fake for Redis) */
			raw?: unknown;
	  }
	| ({ integration: AnyIntegration } & RunIntegrationOptions);

export type Pool = ReturnType<typeof leasePool>["pool"];

/** a real integration, connected through `pool` by its `poolKey`, as the worker pools it */
function realIntegration(
	fake: { integration: AnyIntegration } & RunIntegrationOptions,
	pool: Pool,
) {
	const { variant, resolved } = prepareIntegration(fake.integration, fake);
	const kind = { group: variant.group, variant: variant.variant };
	const get = async () => {
		const opened = await pool(`${kind.group}/${kind.variant}`, variant.poolKey!(resolved), {
			create: () => openVariant(variant, resolved),
			destroy: (o) => o.close(),
		});
		return opened.client;
	};
	return { kind, get };
}

export function fakeIntegrations(
	fakes: Record<string, FakeIntegration>,
	pool: Pool,
): IntegrationSource {
	const sources = new Map<
		string,
		{ kind: { group: string; variant: string }; get(): Promise<unknown> }
	>();
	const find = (id: string) => {
		if (!Object.hasOwn(fakes, id)) return undefined;
		const fake = fakes[id]!;
		if (!sources.has(id))
			if ("integration" in fake) sources.set(id, realIntegration(fake, pool));
			else {
				const parsed = parseIntegrationKind(fake.kind);
				const kind = { group: parsed?.group ?? fake.kind, variant: parsed?.variant ?? "" };
				if ("raw" in fake) setRaw(fake.client, () => fake.raw);
				sources.set(id, { kind, get: async () => fake.client });
			}
		return sources.get(id);
	};
	return {
		kind: (id) => find(id)?.kind,
		get: async (id) => (await find(id!)!.get()) as never,
	};
}

function fakeContext(
	def: BlockDefinition<Params, Handles>,
	c: TestContext,
	logs: LogEntry[],
	pool: Pool,
) {
	const http = c.http ?? unstubbedHttp();
	const kv = c.kv ?? memoryKv();
	const queue = c.queue ?? memoryQueue();
	const vars = {
		logger: recordingLogger(logs),
		httpClient: http,
		httpRequestMethod: "GET",
		httpRequestRoute: c.route ?? "/test",
		getQueryParam: () => undefined,
		getRouteParam: () => "",
		getHeader: () => "",
		setHeader: () => {},
		getCookie: () => "",
		getRequestBody: () => undefined,
		getConfig: (key: string) => (c.config ? c.config[key]! : notStubbed("appconfig")),
		...c.vars,
	} as BlockVars;
	const ctx = {
		projectId: c.projectId ?? "test-project",
		route: c.route ?? "/test",
		apiId: c.apiId ?? "test-api",
		vars,
		httpClient: http,
		dbFactory: { getDbAdapter: () => c.db ?? notStubbed("db") },
		kvFactory: { getKvAdapter: () => kv },
		queueFactory: { getProducer: async () => queue },
		integrations: fakeIntegrations(c.integrations ?? {}, pool),
	};
	// a test grants what the block declares, the way a user approves it
	const granted = {
		integrations: def.permissions?.integrations ?? [],
		appconfig: !!def.permissions?.appconfig,
	};
	return grantContext(ctx, granted, `block ${def.name}`);
}

/** JSON-only, like a queued job's payload; a `schema` param is compiled on the far side */
const serialized = (value: unknown) =>
	value === undefined ? undefined : JSON.parse(JSON.stringify(value));

/**
 * Runs one block the way a worker would, with no Fluxify runtime: params are
 * defaulted and checked, `ctx` is faked, body handles call `handles`' stubs,
 * and the result is routed to the output handle the canvas would take.
 * Rejects only for what the compiler would reject (invoke mode, an unknown
 * stubbed handle); a block that throws resolves with `error`.
 */
export async function runBlock<P extends Params, H extends Handles>(
	def: BlockDefinition<P, H>,
	...[opts]: {} extends RunBlockOptions<P, H> ? [RunBlockOptions<P, H>?] : [RunBlockOptions<P, H>]
): Promise<RunBlockResult<H>> {
	const o = (opts ?? {}) as Common<H> & { params?: Record<string, unknown> };
	const loose = def as unknown as BlockDefinition<Params, Handles>;
	const spec = toHandleSpec(loose.handles);
	const mode = o.invoke ?? "sync";
	const logs: LogEntry[] = [];
	const spans: SpanRecord[] = [];
	const handleCalls: HandleCall[] = [];
	const body = bodyHandles(def.name, spec.body, o.handles ?? {}, handleCalls);
	const wired = Object.keys(body).filter((h) => body[h]!.branches.length);
	const invalid = invokeError(
		mode,
		{ invoke: def.invoke, out: spec.out, body: spec.body.map((b) => b.name) },
		{ body: wired },
	);
	if (invalid) throw new Error(`Block ${def.name} ${invalid}`);

	const life = { ended: false };
	const executeHandle = createExecuteHandle(def.name, body, () => life.ended);
	const pooled = o.ctx?.pool ?? testPool();
	const leases = leasePool(pooled, [o.ctx?.projectId ?? "test-project", def.name]);
	// integrations pool apart from the block's own clients, as on a worker
	const integrationLeases = leasePool(pooled, ["integrations"]);
	const sse = o.ctx?.sse ?? fakeSse();
	const ctx: BlockContext = {
		...fakeContext(loose, o.ctx ?? {}, logs, integrationLeases.pool),
		span: createSpan((s) => spans.push(s)),
		pool: leases.pool,
		sse,
	};
	const schemas = new Set(
		Object.keys(loose.params ?? {}).filter((k) => loose.params![k]!.type === "schema"),
	);
	const queued = mode === "queued";
	// evaluated where the canvas calls the block, so before a queued job's payload
	const callParams = async () => {
		const evaluated = await evaluateParams(loose.params ?? {}, o.params ?? {}, o.input);
		return Object.fromEntries(
			Object.entries(evaluated).map(([k, v]) => [k, queued && !schemas.has(k) ? serialized(v) : v]),
		);
	};

	let outcome: RunOutcome;
	// a `js:` param that throws fails the run before the block is called, never routed to `failure`
	let routable = true;
	try {
		const params = await callParams().catch((error) => {
			routable = false;
			throw error;
		});
		const r = await loose.run({
			params,
			input: queued ? serialized(o.input) : o.input,
			ctx,
			// only a sync call has a run to hand `executeHandle` to
			executeHandle: (mode === "sync" ? executeHandle : undefined) as any,
		});
		outcome = { successful: true, output: r?.output, handle: r?.handle };
	} catch (error) {
		outcome = { successful: false, error };
	} finally {
		leases.release();
		integrationLeases.release();
	}
	if (!o.keepAlive) life.ended = true;
	// a pool made for this run alone would keep a real integration's socket open after it
	if (!o.ctx?.pool && !o.keepAlive) await pooled.close();

	const result: RunBlockResult<H> = {
		output: undefined,
		spans,
		logs,
		handleCalls,
		sse,
		end() {
			life.ended = true;
		},
		callAfterEnd(handle, input, options) {
			life.ended = true;
			return (executeHandle as ExecuteHandle)(handle, input, options);
		},
	};
	if (!outcome.successful) result.error = asError(outcome.error);
	if (routable)
		try {
			const routed = routeResult(def.name, spec.out, outcome);
			result.handle = routed.handle as OutName<H>;
			result.output = routed.output;
		} catch (error) {
			result.error = asError(error);
		}
	return result;
}
