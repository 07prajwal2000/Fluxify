# @fluxify/sdk

Write blocks, integrations and triggers for [Fluxify](https://github.com/Fluxify-rest/Fluxify) as plain TypeScript, and test them without a running server.

A Fluxify **plugin** is one package of these. You write each part as a small file, build the package with [`@fluxify/cli`](https://www.npmjs.com/package/@fluxify/cli), and add it to a Fluxify project.

## Get started

You need [Bun](https://bun.sh). Create a plugin, which installs this package for you:

```sh
bunx @fluxify/cli init my-plugin
cd my-plugin
bunx fluxify-cli blocks create messages/post
bun test
bun run build
```

## A block

```ts
import { block, param } from "@fluxify/sdk/blocks";

export default block({
	name: "acme/slack/messages/post",
	label: "Post message",
	params: { channel: param.string({ required: true }) },
	async run({ params }) {
		return { output: `posted to ${params.channel}` };
	},
});
```

`block()` checks the definition when the file loads and throws an error that names the block, so a mistake shows up in `bun test` and in the build.

## Test it

`runBlock` runs a block the way Fluxify would, with no server, database or network. Fake what the block talks to.

```ts
import { runBlock } from "@fluxify/sdk/testing";
import post from "./post";

const result = await runBlock(post, { params: { channel: "general" } });
```

## Entry points

| Import | What it is for |
| :--- | :--- |
| `@fluxify/sdk` | `plugin()`, which describes the plugin in `src/index.ts`, and the shared shapes |
| `@fluxify/sdk/blocks` | `block()`, `param`, `handle` |
| `@fluxify/sdk/integrations` | `integration()`, for a new kind of connection (database, queue, and so on) |
| `@fluxify/sdk/triggers` | `trigger()`, a loop that starts a workflow |
| `@fluxify/sdk/testing` | `runBlock` and other test helpers |
| `@fluxify/sdk/runtime` | The contract the Fluxify engine runs plugins against |

`zod` is a peer dependency (the plugin's host provides it). The AI and driver packages some integrations use are optional peers.

## Documentation

- [Writing a plugin](https://docs.fluxify.rest/plugins/authoring/getting-started)
- [Block reference](https://docs.fluxify.rest/plugins/authoring/blocks)
- [Testing](https://docs.fluxify.rest/plugins/authoring/testing)
- [Publishing and versions](https://docs.fluxify.rest/plugins/authoring/publishing)

## License

Apache-2.0
