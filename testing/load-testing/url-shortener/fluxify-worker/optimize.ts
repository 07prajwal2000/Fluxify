// Rewrites the compiled route sources into what a hand-written equivalent would look like,
// for measuring how much the generated shape costs. Reads dist/artifacts.json, writes
// dist/artifacts.opt.json. Text-level and tuned to these three graphs; the real fix belongs in
// the emitters of packages/blocks/compiler.ts.
//   bun optimize.ts
//
// 1. a user expression wrapped in `await (async function (input, params) { with ($scope) {…} })`
//    becomes the bare expression when it is a single pure `return`, otherwise a plain (sync or
//    async) function without `with`. Names the scope proxy used to resolve (getRequestBody,
//    dbQuery) are read from `vars` directly.
// 2. `return await $block_N(...)` becomes `return $block_N(...)`: the callee's rejection still
//    reaches $run's catch, and $tagBlock only tags an error once, at the block that threw it.
// 3. a block with nothing left to wait on stops being async.
// 4. the scope proxy is no longer built per request.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const IIFE =
	/\(await \(async function \(input, params\) \{ with \(\$scope\) \{\n([\s\S]*?)\n\} \}\)\(\$in, \$state\.params\)\)/g;
const VARS_FUNCTIONS = ["getRequestBody", "dbQuery"];

/** `input` the parameter: not a property (`x.input`) and not an object key (`{ input: 1 }`) */
const swapInput = (code: string) =>
	code.replace(/(?<![.\w$])input\b/g, (m, offset: number) =>
		/^\s*:/.test(code.slice(offset + m.length)) && /[{,]\s*$/.test(code.slice(0, offset))
			? m
			: "$in",
	);

function inlineExpression(body: string): string {
	const single = /^return ([^;]*?);?$/.exec(body.trim());
	// a lone `return <expression>` with nothing that waits or returns early
	if (single && !/\breturn\b|\bawait\b/.test(single[1].replace(/`[^`]*`/g, "``"))) {
		return `(${swapInput(single[1])})`;
	}
	// several statements: still one function, but sync unless it awaits, and without `with`
	let fixed = body;
	for (const name of VARS_FUNCTIONS) {
		fixed = fixed.replace(new RegExp(`(?<![.\\w$])${name}\\b`, "g"), `vars.${name}`);
	}
	return /\bawait\b/.test(fixed)
		? `(await (async function (input) {\n${fixed}\n})($in))`
		: `(function (input) {\n${fixed}\n})($in)`;
}

function optimize(source: string): string {
	let out = source.replace(IIFE, (_m, body: string) => inlineExpression(body));
	out = out.replaceAll("return await $block_", "return $block_");
	// a block function with no await left in it is a plain function
	out = out.replace(
		/async function (\$block_\d+)\(\$state, \$input, \$end\) \{([\s\S]*?)\n\}\n/g,
		(whole, name: string, body: string) =>
			/\bawait\b/.test(body) ? whole : `function ${name}($state, $input, $end) {${body}\n}\n`,
	);
	// $run keeps its await: it is the one place a rejection from the chain is caught
	out = out.replace(
		"return $block_0($state, input, $endSuccess)",
		"return await $block_0($state, input, $endSuccess)",
	);
	return out.replace("scope: lib.scope(vars),", "scope: undefined,");
}

const dist = resolve(import.meta.dir, "dist");
const entries: { key: string; value: any }[] = JSON.parse(
	readFileSync(`${dist}/artifacts.json`, "utf8"),
);
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
for (const e of entries) {
	if (!e.key.startsWith("route.")) continue;
	const before = e.value.source as string;
	e.value.source = optimize(before);
	console.log(
		e.value.path.padEnd(14),
		`with: ${count(before, /with \(\$scope\)/g)} -> ${count(e.value.source, /with \(\$scope\)/g)}`,
		`await: ${count(before, /\bawait\b/g)} -> ${count(e.value.source, /\bawait\b/g)}`,
		`async fn: ${count(before, /async function/g)} -> ${count(e.value.source, /async function/g)}`,
	);
}
writeFileSync(`${dist}/artifacts.opt.json`, JSON.stringify(entries));
