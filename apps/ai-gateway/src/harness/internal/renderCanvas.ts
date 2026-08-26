/**
 * Renders a canvas as a compact block listing instead of raw JSON.
 *
 * Every agent that reads a canvas already carries each block type's data
 * contract in its system prompt, so the JSON around the values buys nothing:
 * a quoted key and a brace per field, `"position":{"x":240,"y":48}` for two
 * numbers, and `blockName`/`blockDescription` a second time inside `data`
 * because that is how the row is stored. What an agent actually needs is which
 * blocks exist, how each is configured, and what points where.
 *
 * Deliberately NOT truncated. A half-canvas is worse than a big one: the agent
 * cannot tell a canvas that ends from one that was cut, and the tool call it
 * makes to find out re-sends the entire conversation so far.
 */

/** Taught once per render — an agent meeting this notation cold has to guess
 *  otherwise, and a guessed edge is a wrong graph. */
const CANVAS_NOTATION = `Canvas notation: one stanza per block — \`blockType id "name" @x,y\` — then its configuration one field per line, then one \`-> targetBlockId\` line per outgoing connection (\`-> [handle] targetBlockId\` when the handle is not \`source\`). A block with no \`->\` line is terminal. \`#\` is the block's description. \`|\` opens a multi-line value, indented under its key.`;

type CanvasBlock = Record<string, any>;

/** Fields the row carries at the top level and repeats inside `data`. The
 *  block builder's own output contract tells it never to write these into
 *  `data`, so echoing them back there teaches it the opposite. */
const LIFTED_FIELDS = new Set(["blockName", "blockDescription"]);

/**
 * True only for a string that would read back as something other than itself —
 * `"[]"` is a real ambiguity worth two quote characters. `{{ $var }}` opens
 * with a brace but parses as nothing, and quoting every template expression in
 * a canvas is noise on the most common value in the codebase.
 */
function isAmbiguous(value: string): boolean {
	if (!/^[[{"]/.test(value)) return false;
	try {
		JSON.parse(value);
		return true;
	} catch {
		return false;
	}
}

function renderValue(value: unknown, indent: string): string {
	if (value === null || value === undefined) return "null";
	if (typeof value === "string") {
		if (value.includes("\n")) {
			// A YAML block scalar. Block `data` carries user JavaScript, and
			// flattening that onto one line is what makes it unreadable.
			const body = value
				.split("\n")
				.map((line) => `${indent}  ${line}`)
				.join("\n");
			return `|\n${body}`;
		}
		return isAmbiguous(value) ? JSON.stringify(value) : value;
	}
	// ponytail: nested config (conditions, field maps) stays JSON — it is the
	// minority of the bytes and the agent has to reproduce it exactly.
	if (typeof value === "object") return JSON.stringify(value);
	return String(value);
}

function renderBlock(block: CanvasBlock): string {
	const position = block.position as { x?: number; y?: number } | undefined;
	const head = [
		block.blockType ?? "unknown",
		block.id,
		block.blockName ? JSON.stringify(block.blockName) : "",
		position ? `@${position.x ?? 0},${position.y ?? 0}` : "",
	]
		.filter(Boolean)
		.join(" ");

	const lines = [head];
	if (block.blockDescription) lines.push(`  # ${block.blockDescription}`);

	for (const [key, value] of Object.entries(block.data ?? {})) {
		if (LIFTED_FIELDS.has(key)) continue;
		lines.push(`  ${key}: ${renderValue(value, "  ")}`);
	}

	for (const connection of block.connections ?? []) {
		const handle =
			connection.handle && connection.handle !== "source"
				? `[${connection.handle}] `
				: "";
		lines.push(`  -> ${handle}${connection.blockId}`);
	}

	return lines.join("\n");
}

/** Renders a whole canvas, notation legend included so no call site can hand a
 *  model the shape without the key to it. */
export function renderCanvas(canvas: CanvasBlock[] | null | undefined): string {
	if (!Array.isArray(canvas) || canvas.length === 0) {
		return "(empty canvas — it has no blocks yet)";
	}
	return `${CANVAS_NOTATION}\n\n${canvas.map(renderBlock).join("\n\n")}`;
}
