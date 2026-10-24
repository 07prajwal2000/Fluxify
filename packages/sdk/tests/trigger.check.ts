// Type tests for `trigger()` (T1): compiled by `bun run typecheck`, never run.
import { param } from "../blocks.js";
import type { DatabaseAdapter } from "../integrations.js";
import { type IntegrationId, type TriggerConnection, trigger } from "../triggers.js";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
	? true
	: false;
const assert = <T extends true>() => {};

const common = { label: "Poll", icon: "./poll.svg" };

function contextChecks() {
	trigger({
		...common,
		name: "acme/t/poll",
		permissions: { integrations: ["database"] },
		params: {
			db: param.integration({ kind: "database", required: true }),
			every: param.number({ default: 5 }),
			token: param.secret(),
		},
		async start(ctx) {
			assert<
				Equal<typeof ctx.params, { db: IntegrationId<"database">; every: number; token?: string }>
			>();
			const db = await ctx.integrations.get<"database">(ctx.params.db);
			assert<Equal<typeof db, DatabaseAdapter>>();
			assert<Equal<typeof ctx.signal, AbortSignal>>();
			await ctx.emit([{ id: 1 }]);
			// @ts-expect-error emit takes an array of events
			await ctx.emit({ id: 1 });
			const connection = {
				raw: null,
				commit: async () => {},
				moveToDLQ: async (_error?: unknown) => {},
				lag: async () => 0,
			};
			await ctx.emit([], { connection });
			// @ts-expect-error a connection must have the queue-trigger shape
			await ctx.emit([], { connection: { commit: async () => {} } });
			return async () => {};
		},
	});
}

// the shape a built-in queue trigger hands a workflow as `trigger.connection`
// (`@fluxify/blocks` re-exports this very type)
assert<
	Equal<
		TriggerConnection,
		{
			raw: unknown;
			commit(): Promise<void>;
			moveToDLQ(error?: unknown): Promise<void>;
			lag(): Promise<number | null>;
		}
	>
>();

function definitionChecks() {
	// @ts-expect-error start must return its stop function
	trigger({ name: "acme/t/a", label: "A", icon: "./a.svg", start: async () => {} });
	// @ts-expect-error start is required
	trigger({ name: "acme/t/a", label: "A", icon: "./a.svg" });
	trigger({
		name: "acme/t/a",
		label: "A",
		icon: "./a.svg",
		start: async () => async () => {},
		// @ts-expect-error stop moved: return it from start()
		stop: async () => {},
	});
	trigger({
		...common,
		name: "acme/t/a",
		params: {
			mode: param.select({ options: ["a", "b"] }),
			// @ts-expect-error visibleWhen is checked against the trigger's own params, as a block's
			extra: param.string({ visibleWhen: { mode: "c" } }),
		},
		start: async () => async () => {},
	});
}

void contextChecks;
void definitionChecks;
