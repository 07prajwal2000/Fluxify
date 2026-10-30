import { EXACT_VERSION, NPM_PACKAGE_NAME } from "@fluxify/sdk/blocks";
import type ts from "typescript";

type TS = typeof ts;

/** how many levels of object a printed type expands before it falls back to `any` */
export const DEPTH_CAP = 4;

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const FUNCTION = "(...args: any[]) => any";

/** `@types/scope__name` is the types for `@scope/name` */
const runtimeName = (pkg: string) =>
	pkg.startsWith("@types/") ? pkg.slice(7).replace(/^([^_]+)__(.+)$/, "@$1/$2") : pkg;

/** the package a declaration file belongs to: the last `node_modules/<name>` in its path */
function packageOf(file: string) {
	const rest = file.split("node_modules/").at(-1);
	if (rest === undefined || rest === file) return undefined;
	const parts = rest.split("/");
	return parts[0].startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
}

/**
 * Prints a type from the checker as a self-contained type expression the
 * editor can read: the plugin's own types expanded, global types by name, a
 * type an npm package exports as `import("pkg").Name`.
 */
export function createPrinter(
	tsApi: TS,
	program: ts.Program,
	options: ts.CompilerOptions,
	/** a file to resolve packages from */
	from: string,
	/** the exact installed version of a package, from the plugin's node_modules */
	versionOf: (pkg: string) => string | undefined,
) {
	const checker = program.getTypeChecker();
	const F = tsApi.TypeFlags;
	/** the packages the type being printed imports: name -> exact version */
	let packages: Record<string, string> = {};
	const exportsOf = new Map<string, Map<ts.Symbol, string>>();

	const resolve = (s: ts.Symbol) =>
		s.flags & tsApi.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s;

	/** every name a package's root entry exports, by the symbol behind it */
	function rootExports(pkg: string) {
		let names = exportsOf.get(pkg);
		if (names) return names;
		names = new Map();
		exportsOf.set(pkg, names);
		const file = tsApi.resolveModuleName(pkg, from, options, tsApi.sys).resolvedModule
			?.resolvedFileName;
		const source = file && program.getSourceFile(file);
		const module = source && checker.getSymbolAtLocation(source);
		for (const e of module ? checker.getExportsOfModule(module) : [])
			if (e.name !== "default") names.set(resolve(e), e.name);
		return names;
	}

	/** the type's own generic arguments, or none */
	function argsOf(type: ts.Type): readonly ts.Type[] {
		if (type.aliasSymbol) return type.aliasTypeArguments ?? [];
		const target = (type as ts.TypeReference).target;
		const count = target?.typeParameters?.length ?? 0;
		return count ? checker.getTypeArguments(type as ts.TypeReference).slice(0, count) : [];
	}

	/** `Date`, `Promise<T>`, `import("pkg").Name<T>`, or undefined when the type has to be expanded */
	function named(type: ts.Type, depth: number, stack: Set<ts.Type>): string | undefined {
		const symbol = type.aliasSymbol ?? type.symbol;
		const declarations = symbol?.declarations;
		if (!declarations?.length || symbol.name.startsWith("__")) return undefined;
		const suffix = () => {
			const args = argsOf(type).map((a) => print(a, depth, stack));
			return args.length ? `<${args.join(", ")}>` : "";
		};
		const files = declarations.map((d) => d.getSourceFile());
		if (files.every((f) => program.isSourceFileDefaultLibrary(f))) return symbol.name + suffix();
		const declared = packageOf(files[0].fileName);
		if (!declared || !files.every((f) => packageOf(f.fileName) === declared)) return undefined;
		const pkg = runtimeName(declared);
		const exported = rootExports(pkg).get(resolve(symbol));
		if (!exported) return undefined;
		// the runtime package's version, else the types package's
		const version = versionOf(pkg) ?? versionOf(declared);
		if (!version || !EXACT_VERSION.test(version) || !NPM_PACKAGE_NAME.test(pkg)) return undefined;
		packages[pkg] = version;
		return `import(${JSON.stringify(pkg)}).${exported}${suffix()}`;
	}

	const wrap = (type: ts.Type, text: string) =>
		type.isUnionOrIntersection() || text === FUNCTION ? `(${text})` : text;

	function union(types: readonly ts.Type[], depth: number, stack: Set<ts.Type>) {
		const parts: string[] = [];
		const literals = types.filter((t) => t.flags & F.BooleanLiteral).length;
		for (const t of types) {
			// the checker holds `boolean` as `true | false`
			let text = t.flags & F.BooleanLiteral && literals === 2 ? "boolean" : print(t, depth, stack);
			if (text === FUNCTION) text = `(${text})`;
			if (!parts.includes(text)) parts.push(text);
		}
		return parts.join(" | ");
	}

	function tuple(type: ts.TupleTypeReference, depth: number, stack: Set<ts.Type>) {
		const flags = type.target.elementFlags;
		const items = checker.getTypeArguments(type).map((t, i) => {
			const text = print(t, depth, stack);
			if (flags[i] & tsApi.ElementFlags.Rest) return `...${wrap(t, text)}[]`;
			if (flags[i] & tsApi.ElementFlags.Variadic) return `...${text}`;
			return flags[i] & tsApi.ElementFlags.Optional ? `${wrap(t, text)}?` : text;
		});
		return `[${items.join(", ")}]`;
	}

	function members(type: ts.Type, depth: number, stack: Set<ts.Type>) {
		const lines: string[] = [];
		for (const info of checker.getIndexInfosOfType(type)) {
			const key = print(info.keyType, depth, stack);
			lines.push(`[key: ${key}]: ${print(info.type, depth, stack)}`);
		}
		for (const prop of checker.getPropertiesOfType(type)) {
			if (prop.name.startsWith("__@") || prop.name.startsWith("#")) continue;
			const propType = checker.getTypeOfSymbol(prop);
			const optional = !!(prop.flags & tsApi.SymbolFlags.Optional);
			// `a?: T` already says it may be missing, so a lone `undefined` is no property at all
			const types = (propType.isUnion() ? propType.types : [propType]).filter(
				(t) => !optional || !(t.flags & F.Undefined),
			);
			if (!types.length) continue;
			const whole = types.length === (propType.isUnion() ? propType.types.length : 1);
			const text = whole ? print(propType, depth, stack) : union(types, depth, stack);
			const key = IDENTIFIER.test(prop.name) ? prop.name : JSON.stringify(prop.name);
			lines.push(`${key}${optional ? "?" : ""}: ${text}`);
		}
		return lines.length ? `{ ${lines.join("; ")} }` : "{}";
	}

	function print(type: ts.Type, depth: number, stack: Set<ts.Type>): string {
		const flags = type.flags;
		if (
			flags &
			(F.Any | F.TypeParameter | F.Index | F.IndexedAccess | F.Conditional | F.Substitution)
		)
			return "any";
		if (flags & F.UniqueESSymbol) return "any";
		if (flags & F.EnumLiteral && flags & (F.StringLiteral | F.NumberLiteral))
			return JSON.stringify((type as ts.LiteralType).value);
		if (flags & F.Enum) return "number";
		if (
			flags &
			(F.StringLike |
				F.NumberLike |
				F.BigIntLike |
				F.BooleanLike |
				F.ESSymbol |
				F.Null |
				F.Undefined |
				F.Void |
				F.Unknown |
				F.Never |
				F.NonPrimitive)
		)
			return checker.typeToString(type, undefined, tsApi.TypeFormatFlags.NoTruncation);
		// a union an package names (`FinishReason`) stays that name
		const alias =
			type.aliasSymbol && flags & (F.Union | F.Intersection)
				? named(type, depth, stack)
				: undefined;
		if (alias) return alias;
		if (type.isUnion()) return union(type.types, depth, stack);
		if (type.isIntersection()) {
			// a branded primitive (`string & { __brand: "id" }`) is the primitive
			const primitive = type.types.find(
				(t) => t.flags & (F.StringLike | F.NumberLike | F.BigIntLike | F.BooleanLike),
			);
			if (primitive) return print(primitive, depth, stack);
		}
		if (!(flags & (F.Object | F.Intersection))) return "any";
		if (stack.has(type)) return "any";
		stack.add(type);
		try {
			if (checker.isArrayType(type)) {
				const [element] = checker.getTypeArguments(type as ts.TypeReference);
				return `${wrap(element, print(element, depth, stack))}[]`;
			}
			if (checker.isTupleType(type)) return tuple(type as ts.TupleTypeReference, depth, stack);
			const reference = named(type, depth, stack);
			if (reference) return reference;
			if (type.getCallSignatures().length) return FUNCTION;
			if (type.getConstructSignatures().length) return "any";
			return depth >= DEPTH_CAP ? "any" : members(type, depth + 1, stack);
		} finally {
			stack.delete(type);
		}
	}

	return {
		/** a type's text, with the packages it imports. `undefined` is dropped from a top-level union: an optional output */
		print(type: ts.Type) {
			packages = {};
			const types = (type.isUnion() ? type.types : [type]).filter((t) => !(t.flags & F.Undefined));
			return { text: types.length ? union(types, 0, new Set()) : "", packages };
		},
	};
}
