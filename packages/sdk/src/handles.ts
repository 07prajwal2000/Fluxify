import { z } from "zod";

/** Where a body handle sits: left corners are above/below the icon, right ones opposite. */
export type BodyCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

/**
 * A block type's handles as plain data (a plugin manifest, the engine's block
 * metadata). Every consumer — compiler, layout, save validation, AI gateway,
 * portal — resolves a block's handles from this, so none needs the block's code.
 */
export type HandleSpec = {
	in: string[];
	out: [] | ["source"] | ["success", "failure"];
	body: { name: string; corner: BodyCorner; allowMultiple?: boolean }[];
	/** handle name -> deprecation message, for the ones `deprecated(...)` marked */
	deprecated?: Record<string, string>;
};

// an edge handle id is `<blockId>-<name>`, and readers split on the last `-`
const handleName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "must be a plain identifier");

export const handleSpecSchema = z
	.object({
		in: z.array(handleName).default(["target"]),
		out: z.union([
			z.tuple([]),
			z.tuple([z.literal("source")]),
			z.tuple([z.literal("success"), z.literal("failure")]),
		]),
		body: z
			.array(
				z.object({
					name: handleName,
					corner: z.enum(["top-left", "top-right", "bottom-left", "bottom-right"]),
					allowMultiple: z.boolean().optional(),
				}),
			)
			.default([]),
		deprecated: z.record(z.string(), z.string().min(1)).optional(),
	})
	.superRefine((spec, ctx) => {
		const names = [...spec.in, ...spec.out, ...spec.body.map((b) => b.name)];
		const dupes = names.filter((n, i) => names.indexOf(n) !== i);
		if (dupes.length)
			ctx.addIssue({ code: "custom", message: `duplicate handle names: ${[...new Set(dupes)]}` });
		const unknown = Object.keys(spec.deprecated ?? {}).filter((n) => !names.includes(n));
		if (unknown.length)
			ctx.addIssue({ code: "custom", message: `deprecated handles not declared: ${unknown}` });
	});

export type InHandle<N extends string = string> = { kind: "in"; name: N; deprecated?: string };
export type OutHandle<
	N extends "source" | "success" | "failure" = "source" | "success" | "failure",
> = { kind: "out"; name: N; deprecated?: string };
export type BodyHandle<N extends string = string, M extends boolean = boolean> = {
	kind: "body";
	name: N;
	corner: BodyCorner;
	allowMultiple: M;
	deprecated?: string;
};

/** The only output shapes a block may have: terminal, one way on, or a branch. */
export type OutHandles =
	| readonly []
	| readonly [OutHandle<"source">]
	| readonly [OutHandle<"success">, OutHandle<"failure">];

export type Handles = {
	/** default `[handle.in("target")]` */
	in?: readonly InHandle[];
	out: OutHandles;
	body?: readonly BodyHandle[];
};

export const handle = {
	in: <const N extends string>(name: N): InHandle<N> => ({ kind: "in", name }),
	out: <const N extends "source" | "success" | "failure">(name: N): OutHandle<N> => ({
		kind: "out",
		name,
	}),
	/**
	 * A handle that starts a nested chain the block runs with `executeHandle`.
	 * `allowMultiple` lets it carry several edges, each its own branch.
	 */
	body: <const N extends string, const M extends boolean = false>(
		name: N,
		corner: BodyCorner,
		options?: { allowMultiple?: M },
	): BodyHandle<N, M> => ({
		kind: "body",
		name,
		corner,
		allowMultiple: (options?.allowMultiple ?? false) as M,
	}),
};

/** The plain spec of declared handles; `in` defaults to `target`, `out` to `source`. */
export function toHandleSpec(handles: Handles | undefined): HandleSpec {
	const ins = handles?.in ?? [handle.in("target")];
	const outs = handles?.out ?? [handle.out("source")];
	const body = handles?.body ?? [];
	const deprecated = Object.fromEntries(
		[...ins, ...outs, ...body].flatMap((h) => (h.deprecated ? [[h.name, h.deprecated]] : [])),
	);
	return {
		in: ins.map((h) => h.name),
		out: outs.map((h) => h.name) as HandleSpec["out"],
		body: body.map(({ name, corner, allowMultiple }) => ({
			name,
			corner,
			...(allowMultiple ? { allowMultiple } : {}),
		})),
		...(Object.keys(deprecated).length ? { deprecated } : {}),
	};
}
