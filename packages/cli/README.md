# @fluxify/cli

Create, build and pack [Fluxify](https://github.com/Fluxify-rest/Fluxify) plugins.

It needs [Bun](https://bun.sh). The plugin's tests and build run on it too.

## Quick start

```sh
bunx @fluxify/cli init my-plugin      # asks for a name, URL, version and description
cd my-plugin
bunx fluxify-cli blocks create messages/post
bun test
bun run build                         # my-plugin-0.1.0.tgz, ready to add to Fluxify
```

The package is `@fluxify/cli` and the command it installs is `fluxify-cli`. Before you have a plugin, run `init` by the package name (`bunx @fluxify/cli init`). Inside a plugin the CLI is installed, so use the command name (`bunx fluxify-cli …`); `bunx fluxify-cli` outside a plugin finds nothing to run.

## Commands

| Command | What it does |
| :--- | :--- |
| `fluxify-cli init [dir]` | Start an empty plugin in `dir` (default: here) |
| `fluxify-cli build` | Build the plugin: `dist/`, `fluxify.json` and `<scope>-<name>-<version>.tgz` |
| `fluxify-cli blocks create <name>` | Add `src/blocks/<name>.ts` and a test next to it |
| `fluxify-cli integrations create <name>` | Add `src/integrations/<name>.ts` |
| `fluxify-cli triggers create <name>` | Add `src/triggers/<name>.ts` |

`fluxify-cli --help` lists the commands, `fluxify-cli <command> --help` shows one command's options, and `fluxify-cli --version` prints the CLI's version.

### `init` options

With no options, `init` asks for each setting one by one. Giving an option answers its question, and `-y` asks nothing.

| Option | Meaning |
| :--- | :--- |
| `-n, --name <scope/name>` | The plugin's name, like `acme/slack`. Required |
| `-u, --url <https url>` | Where its docs or source live. Required |
| `-v, --version <x.y.z>` | The plugin's version (default: `0.1.0`) |
| `-d, --description <text>` | What the plugin is for (default: none) |
| `-y, --yes` | Ask nothing; use the defaults for what is not given |
| `-f, --force` | Write into a folder that is not empty |
| `--no-install` | Skip `bun install` |

## Documentation

- [Writing a plugin](https://docs.fluxify.rest/plugins/authoring/getting-started)
- [Publishing and versions](https://docs.fluxify.rest/plugins/authoring/publishing)
- [SDK: `@fluxify/sdk`](https://www.npmjs.com/package/@fluxify/sdk)

## License

Apache-2.0
