import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type ManifestEntry, OUTPUT_PACKAGES_MAX, OUTPUT_TYPE_MAX } from "@fluxify/sdk/blocks";
import type ts from "typescript";
import { createPrinter } from "./printType";
import type { Found } from "./sources";

type TS = typeof ts;
type Handle = "source" | "success" | "failure";
type Printed = { text: string; packages: Record<string, string> };

/** the `output` and `outputPackages` a block's manifest entry ends up with */
export type OutputFields = {
	output?: string | Partial<Record<Handle, string>>;
	outputPackages?: Record<string, string>;
};

/** the plugin's tsconfig options when it has one, else sensible defaults; never emits */
function compilerOptions(api: TS, root: string): ts.CompilerOptions {
	const file = join(root, "tsconfig.json");
	let options: ts.CompilerOptions = {
		target: api.ScriptTarget.ES2022,
		module: api.ModuleKind.ESNext,
		moduleResolution: api.ModuleResolutionKind.Bundler,
		lib: ["lib.es2022.d.ts"],
		strict: true,
		esModuleInterop: true,
	};
	const read = existsSync(file) ? api.readConfigFile(file, api.sys.readFile) : undefined;
	if (read && !read.error)
		options = api.parseJsonConfigFileContent(read.config, api.sys, root).options;
	return {
		...options,
		noEmit: true,
		skipLibCheck: true,
		incremental: false,
		composite: false,
		declaration: false,
	};
}

/** the version in the nearest `node_modules/<pkg>/package.json` at or above `root` */
function installedVersion(root: string, pkg: string): string | undefined {
	for (let dir = root; ; dir = dirname(dir)) {
		const file = join(dir, "node_modules", pkg, "package.json");
		if (existsSync(file)) {
			try {
				return JSON.parse(readFileSync(file, "utf8")).version;
			} catch {
				return undefined;
			}
		}
		if (dirname(dir) === dir) return undefined;
	}
}

/** whether `text` is one type expression and nothing else */
function isOneType(api: TS, text: string) {
	const source = api.createSourceFile("check.ts", `type X = ${text};`, api.ScriptTarget.ESNext);
	const { parseDiagnostics } = source as unknown as { parseDiagnostics: unknown[] };
	return (
		parseDiagnostics.length === 0 &&
		source.statements.length === 1 &&
		api.isTypeAliasDeclaration(source.statements[0])
	);
}

/** the object literal a block's default export passes to `block(...)` */
function definitionOf(api: TS, checker: ts.TypeChecker, source: ts.SourceFile) {
	const module = checker.getSymbolAtLocation(source);
	const symbol = module && checker.getExportsOfModule(module).find((e) => e.name === "default");
	let node: ts.Node | undefined = symbol?.declarations?.[0];
	for (let hops = 0; node && hops < 4; hops++) {
		if (api.isExportAssignment(node)) node = node.expression;
		else if (api.isVariableDeclaration(node)) node = node.initializer;
		else if (api.isIdentifier(node)) node = checker.getSymbolAtLocation(node)?.valueDeclaration;
		else if (api.isAsExpression(node) || api.isParenthesizedExpression(node))
			node = node.expression;
		else break;
	}
	const arg = node && api.isCallExpression(node) ? node.arguments[0] : undefined;
	return arg && api.isObjectLiteralExpression(arg) ? arg : undefined;
}

/** what `run` returns, as its union members: no promise, no `void` */
function resultsOf(api: TS, checker: ts.TypeChecker, definition: ts.ObjectLiteralExpression) {
	const run = checker.getPropertyOfType(checker.getTypeAtLocation(definition), "run");
	const signature =
		run && checker.getTypeOfSymbolAtLocation(run, definition).getCallSignatures()[0];
	if (!signature) return [];
	const returned = signature.getReturnType();
	const awaited = checker.getAwaitedType(returned) ?? returned;
	return (awaited.isUnion() ? awaited.types : [awaited]).filter(
		(m) => !(m.flags & (api.TypeFlags.Void | api.TypeFlags.Undefined)),
	);
}

/** the handles one returned shape leaves by: its `handle` literals, else the first out handle */
function handlesOf(
	api: TS,
	checker: ts.TypeChecker,
	result: ts.Type,
	at: ts.Node,
	out: Handle[],
): Handle[] {
	const symbol = checker.getPropertyOfType(result, "handle");
	if (!symbol) return [out[0]];
	const type = checker.getTypeOfSymbolAtLocation(symbol, at);
	const handles = (type.isUnion() ? type.types : [type]).map((t) =>
		t.flags & api.TypeFlags.StringLiteral &&
		out.includes((t as ts.StringLiteralType).value as Handle)
			? ((t as ts.StringLiteralType).value as Handle)
			: out[0],
	);
	return [...new Set(handles)];
}

/** the printed `output` of every shape a block returns, per out handle; null once one is unknown */
function printResults(
	api: TS,
	checker: ts.TypeChecker,
	definition: ts.ObjectLiteralExpression,
	out: Handle[],
	print: (type: ts.Type) => Printed,
) {
	const found = new Map<Handle, Printed | null>();
	for (const result of resultsOf(api, checker, definition)) {
		const symbol = checker.getPropertyOfType(result, "output");
		if (!symbol) continue;
		const type = checker.getTypeOfSymbolAtLocation(symbol, definition);
		const unknown = type.flags & (api.TypeFlags.Any | api.TypeFlags.Unknown | api.TypeFlags.Never);
		const printed = unknown ? undefined : print(type);
		const useless = !printed || ["", "any", "unknown", "never"].includes(printed.text);
		for (const handle of handlesOf(api, checker, result, definition, out)) {
			const known = found.get(handle);
			// a shape whose output is unknown makes the whole handle unknown
			if (useless || known === null) found.set(handle, null);
			else
				found.set(handle, {
					text: known ? `${known.text} | ${printed.text}` : printed.text,
					packages: { ...known?.packages, ...printed.packages },
				});
		}
	}
	return found;
}

/**
 * The block's `output` and `outputPackages` once the inferred types fill the
 * handles the author left out. A string `output` is the first out handle's.
 */
function merge(
	entry: ManifestEntry,
	inferred: Map<Handle, Printed>,
	warnings: string[],
	type: string,
): OutputFields | undefined {
	const out = entry.handles.out as Handle[];
	const author =
		typeof entry.output === "string" ? { [out[0]]: entry.output } : (entry.output ?? {});
	const fill = out.filter((h) => !(h in author) && inferred.has(h));
	if (!fill.length) return undefined;
	const types = { ...author, ...Object.fromEntries(fill.map((h) => [h, inferred.get(h)!.text])) };
	const output = out.filter((h) => h in types).map((h) => [h, types[h]]);
	// the author's version of a package wins
	const packages = { ...entry.outputPackages };
	for (const h of fill)
		for (const [name, version] of Object.entries(inferred.get(h)!.packages))
			packages[name] ??= version;
	const names = Object.keys(packages);
	if (names.length > OUTPUT_PACKAGES_MAX)
		warnings.push(
			`${type}: the output type uses ${names.length} packages and only ${OUTPUT_PACKAGES_MAX} are kept: ${names.slice(OUTPUT_PACKAGES_MAX).join(", ")} will not load in the editor`,
		);
	return {
		output:
			output.length === 1 && output[0][0] === out[0] ? output[0][1] : Object.fromEntries(output),
		...(names.length && {
			outputPackages: Object.fromEntries(Object.entries(packages).slice(0, OUTPUT_PACKAGES_MAX)),
		}),
	};
}

/**
 * Reads what each block's `run` returns and writes the `output` type for the
 * handles the author left out, with the packages it imports from. A handle
 * whose output is `any`, `unknown` or missing gets nothing. Only reads types:
 * errors in the plugin's source are not reported here.
 */
export async function inferOutputs(
	root: string,
	blocks: Found[],
	entries: Record<string, ManifestEntry>,
): Promise<{ outputs: Record<string, OutputFields>; warnings: string[] }> {
	const outputs: Record<string, OutputFields> = {};
	const warnings: string[] = [];
	if (!blocks.length) return { outputs, warnings };
	try {
		const api = (await import("typescript")).default as TS;
		const options = compilerOptions(api, root);
		const program = api.createProgram(
			blocks.map((b) => b.file),
			options,
		);
		const checker = program.getTypeChecker();
		const printer = createPrinter(api, program, options, blocks[0].file, (pkg) =>
			installedVersion(root, pkg),
		);
		for (const block of blocks) {
			const source = program.getSourceFile(block.file);
			const definition = source && definitionOf(api, checker, source);
			const entry = entries[block.type];
			if (!definition || !entry?.handles.out.length) continue;
			const usable = new Map<Handle, Printed>();
			const found = printResults(
				api,
				checker,
				definition,
				entry.handles.out as Handle[],
				printer.print,
			);
			for (const [handle, printed] of found) {
				if (!printed) continue;
				const { text } = printed;
				if (text.length > OUTPUT_TYPE_MAX)
					warnings.push(
						`${block.type}: the output type of '${handle}' is ${text.length} characters, over the limit of ${OUTPUT_TYPE_MAX}, so the editor uses any`,
					);
				else if (!isOneType(api, text))
					warnings.push(
						`${block.type}: the output type of '${handle}' could not be written as a type, so the editor uses any`,
					);
				else usable.set(handle, printed);
			}
			const merged = merge(entry, usable, warnings, block.type);
			if (merged) outputs[block.type] = merged;
		}
	} catch (error) {
		warnings.push(`could not infer output types: ${(error as Error).message}`);
	}
	return { outputs, warnings };
}
