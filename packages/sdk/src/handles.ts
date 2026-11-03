import { z } from "zod";

/** Where a body handle sits: left corners are above/below the icon, right ones opposite. */
export type BodyCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

/**
 * Where a handle sits on its block. A side spreads its handles evenly along that
 * edge; a corner stacks them from the corner, each with its name shown.
 */
export type HandlePosition = "left" | "right" | "top" | "bottom" | BodyCorner;

const HANDLE_POSITIONS = [
	"left",
	"right",
	"top",
	"bottom",
	"top-left",
	"top-right",
	"bottom-left",
	"bottom-right",
] as const;

/**
 * A block type's handles as plain data (a plugin manifest, the engine's block
 * metadata). Every consumer — compiler, layout, save validation, AI gateway,
 * portal — resolves a block's handles from this, so none needs the block's code.
 */
export type HandleSpec = {
	in: string[];
	out: [] | ["source"] | ["success", "failure"];
	body: { name: string; corner: HandlePosition; allowMultiple?: boolean }[];
	/**
	 * handle name -> where it sits, for the `in` / `out` handles moved off their
	 * default side (inputs left, outputs right). Body handles carry their own in `corner`.
	 */
	position?: Record<string, HandlePosition>;
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
					corner: z.enum(HANDLE_POSITIONS),
					allowMultiple: z.boolean().optional(),
				}),
			)
			.default([]),
		deprecated: z.record(z.string(), z.string().min(1)).optional(),
		position: z.record(z.string(), z.enum(HANDLE_POSITIONS)).optional(),
	})
	.superRefine((spec, ctx) => {
		const names = [...spec.in, ...spec.out, ...spec.body.map((b) => b.name)];
		const dupes = names.filter((n, i) => names.indexOf(n) !== i);
		if (dupes.length)
			ctx.addIssue({ code: "custom", message: `duplicate handle names: ${[...new Set(dupes)]}` });
		const unknown = Object.keys(spec.deprecated ?? {}).filter((n) => !names.includes(n));
		if (unknown.length)
			ctx.addIssue({ code: "custom", message: `deprecated handles not declared: ${unknown}` });
		const moved = Object.keys(spec.position ?? {}).filter(
			(n) => ![...spec.in, ...spec.out].includes(n),
		);
		if (moved.length)
			ctx.addIssue({
				code: "custom",
				message: `position set for handles that are not an input or output: ${moved}`,
			});
	});

export type InHandle<N extends string = string> = {
	kind: "in";
	name: N;
	position?: HandlePosition;
	deprecated?: string;
};
export type OutHandle<
	N extends "source" | "success" | "failure" = "source" | "success" | "failure",
> = { kind: "out"; name: N; position?: HandlePosition; deprecated?: string };
export type BodyHandle<N extends string = string, M extends boolean = boolean> = {
	kind: "body";
	name: N;
	corner: HandlePosition;
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
	/** An input; `position` moves it off the left edge. */
	in: <const N extends string>(name: N, options?: { position?: HandlePosition }): InHandle<N> => ({
		kind: "in",
		name,
		...(options?.position && { position: options.position }),
	}),
	/** An output; `position` moves it off the right edge. */
	out: <const N extends "source" | "success" | "failure">(
		name: N,
		options?: { position?: HandlePosition },
	): OutHandle<N> => ({
		kind: "out",
		name,
		...(options?.position && { position: options.position }),
	}),
	/**
	 * A handle that starts a nested chain the block runs with `executeHandle`.
	 * `allowMultiple` lets it carry several edges, each its own branch.
	 */
	body: <const N extends string, const M extends boolean = false>(
		name: N,
		corner: HandlePosition,
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
	const position = Object.fromEntries(
		[...ins, ...outs].flatMap((h) => (h.position ? [[h.name, h.position]] : [])),
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
		...(Object.keys(position).length ? { position } : {}),
	};
}
