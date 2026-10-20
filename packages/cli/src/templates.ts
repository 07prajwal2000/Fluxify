// The files `init` and `blocks create` write. Plain functions: a template
// engine would be longer than the files it fills in.

/** build output, like dist/: `blocks build` regenerates and validates it every time */
export const GITIGNORE = `node_modules
dist
*.tgz
fluxify.json
`;

export const TSCONFIG = `${JSON.stringify(
	{
		compilerOptions: {
			target: "ESNext",
			module: "ESNext",
			moduleResolution: "bundler",
			lib: ["ESNext"],
			strict: true,
			skipLibCheck: true,
			noEmit: true,
		},
		include: ["src"],
	},
	null,
	2,
)}\n`;

export type PackageSpecs = {
	sdk: string;
	zod: string;
	cli: string | null;
	typescript: string;
	bunTypes: string;
};

/**
 * The npm name is `@scope/name`: valid for any Fluxify plugin name, and the
 * tarball `bun pm pack` makes from it, `scope-name-<version>.tgz`, is the one
 * `blocks build` promises.
 */
export const packageJson = (name: string, url: string, specs: PackageSpecs) =>
	`${JSON.stringify(
		{
			name: `@${name}`,
			version: "0.1.0",
			description: `Fluxify blocks: ${name}`,
			type: "module",
			fluxify: { name, url },
			files: ["dist", "icons", "fluxify.json"],
			scripts: { build: "fluxify-cli blocks build", test: "bun test" },
			dependencies: { "@fluxify/sdk": specs.sdk, zod: specs.zod },
			devDependencies: {
				...(specs.cli && { "@fluxify/cli": specs.cli }),
				"@types/bun": specs.bunTypes,
				typescript: specs.typescript,
			},
		},
		null,
		2,
	)}\n`;

export const readme = (name: string, url: string) => `# ${name}

Blocks for Fluxify. Source and docs: ${url}

## Add a block

\`\`\`sh
bunx fluxify-cli blocks create <name>
\`\`\`

This writes \`src/blocks/<name>.ts\` and a test next to it, \`<name>.test.ts\`. A block is a file there that default-exports
\`block({...})\`, and its type is \`${name}/<path>\`: \`src/blocks/messages/post.ts\` is
\`${name}/messages/post\`.

## Test

\`\`\`sh
bun test
\`\`\`

\`runBlock\` from \`@fluxify/sdk/testing\` runs one block the way Fluxify would, with no
server: stub its body handles and \`ctx\` (HTTP, databases and app config must be stubbed).

## Build

\`\`\`sh
bun run build
\`\`\`

This writes \`dist/\`, \`fluxify.json\` and \`${name.replace("/", "-")}-<version>.tgz\`, the file to
upload to Fluxify. Commit \`bun.lock\`: workers install the plugin's dependencies from it.
`;

export const exampleBlock = (type: string) => `import { block, param } from "@fluxify/sdk/blocks";

export default block({
	name: "${type}",
	label: "${type.split("/").at(-1)}",
	description: "Greets someone. Replace this with what your block does.",
	docs: \`Greets someone by name.

## When to use it
Put it after any block that produces a name.

## Inputs
| Name | Required | Default |
| :--- | :--- | :--- |
| Name | Yes | |

## Outputs
Returns the greeting on the \\\`source\\\` handle.\`,
	params: {
		who: param.string({ label: "Name", required: true }),
	},
	async run({ params }) {
		return { output: \`Hello, \${params.who}!\` };
	},
});
`;

/** `blocks create`'s test for the example block, next to it */
export const exampleTest = (file: string) => `import { expect, it } from "bun:test";
import { runBlock } from "@fluxify/sdk/testing";
import block from "./${file}";

it("greets by name", async () => {
	const r = await runBlock(block, { params: { who: "Ada" } });
	expect(r.error).toBeUndefined();
	expect(r.handle).toBe("source");
	expect(r.output).toBe("Hello, Ada!");
});

it("needs a name", async () => {
	const r = await runBlock(block, { params: {} as never });
	expect(r.error?.message).toBe("param 'who' is required");
});
`;
