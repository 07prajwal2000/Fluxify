/**
 * `import` is illegal inside the function body user code is inlined into, so the
 * compiler lifts every import statement out of the block and turns it into one
 * module load per compiled graph — evaluated once at instantiation (compile /
 * hot reload), never per request.
 */

export type HoistedImport = {
	spec: string;
	/** local name -> property on the module namespace; null = whole namespace */
	bindings: { local: string; imported: string | null }[];
};

// Locates imports; `staticSpecifiers` below is what decides whether a hit is
// real, so this only has to be generous. `\s+` after `import` keeps it off
// dynamic `import(...)` calls.
const IMPORT_RE = /^[ \t]*import\s+(?:([^'"]+?)\s+from\s+)?("[^"]*"|'[^']*')[ \t]*;?/gm;

const IDENT = /^[A-Za-z_$][\w$]*$/;
const TYPE_ONLY = /^type\s/;

/** strips import statements from user code and returns what they bound */
export function hoistImports(code: string) {
	const matches = [...code.matchAll(IMPORT_RE)];
	if (!matches.length) return { code, imports: [] as HoistedImport[] };

	const real = staticSpecifiers(code);
	const imports: HoistedImport[] = [];
	let stripped = "";
	let cursor = 0;

	for (const match of matches) {
		const clause = match[1]?.trim();
		const spec = match[2].slice(1, -1);
		// A type-only import is erased by the transpiler, so it never shows up in
		// `real` — but it is still invalid at runtime and has to go.
		const typeOnly = !!clause && TYPE_ONLY.test(clause);
		// Anything the parser did not see as an import is text that merely looks
		// like one (inside a template literal, say). Leave it alone.
		if (real && !real.has(spec) && !typeOnly) continue;

		// a type-only import is erased, not turned into a side-effect load
		if (!typeOnly) imports.push({ spec, bindings: parseClause(clause) });
		stripped += code.slice(cursor, match.index);
		cursor = match.index + match[0].length;
	}

	return { code: stripped + code.slice(cursor), imports };
}

/**
 * The specifiers a real parser sees as static imports. Bun's transpiler is
 * already in the runtime, tolerates a bare `return` (user code is a function
 * body), and elides type-only imports — so a hit missing from this set is a
 * false positive. Returns null where there is no parser or the code will not
 * parse, and the regex is trusted on its own.
 */
function staticSpecifiers(code: string): Set<string> | null {
	const transpiler = (globalThis as any).Bun?.Transpiler;
	if (!transpiler) return null;
	try {
		const { imports } = new transpiler({ loader: "ts" }).scan(code);
		return new Set(
			imports
				.filter((entry: any) => entry.kind === "import-statement")
				.map((entry: any) => entry.path),
		);
	} catch {
		return null;
	}
}

function parseClause(clause?: string): HoistedImport["bindings"] {
	if (!clause) return []; // import "side-effect-only"
	const bindings: HoistedImport["bindings"] = [];
	const named = clause.match(/\{([\s\S]*)\}/);
	const head = clause.replace(/\{[\s\S]*\}/, "").trim();

	for (const part of splitList(head)) {
		const namespace = part.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)$/);
		if (namespace) bindings.push({ local: namespace[1], imported: null });
		else if (IDENT.test(part)) bindings.push({ local: part, imported: "default" });
		else throw new Error(`Unsupported import syntax: import ${clause} from ...`);
	}

	for (const part of splitList(named?.[1] ?? "")) {
		if (TYPE_ONLY.test(part)) continue; // `{ type Foo, bar }`
		const [imported, local = imported] = part.split(/\s+as\s+/).map((s) => s.trim());
		if (!IDENT.test(imported) || !IDENT.test(local)) {
			throw new Error(`Unsupported import syntax: import ${clause} from ...`);
		}
		bindings.push({ local, imported });
	}
	return bindings;
}

function splitList(source: string) {
	return source
		.split(",")
		.map((part) => part.trim())
		.filter(Boolean);
}
