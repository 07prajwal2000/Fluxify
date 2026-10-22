# integrations

An example Fluxify plugin that adds integrations **and** a block that uses one.

| File | What it shows |
| :--- | :--- |
| `src/integrations/cache.ts` | A **variant of the built-in `kv` group**, backed by Redis. The built-in KV blocks can use it unchanged, and `poolKey` keeps one client per connection URL |
| `src/integrations/smtp.ts` | A **group of the plugin's own** (`email`, filed as `fluxify-examples/email`) with an `smtp` variant. Its password is a `param.secret()`; `connect` reads the value with `ctx.getConfig` |
| `src/blocks/email/send.ts` | A block with `permissions.integrations: ["fluxify-examples/email"]`, a `param.integration({ kind })`, and `ctx.integrations.get<typeof smtp>` |
| `src/integrations/smtp.test.ts` | `runIntegration` against a real in-process SMTP server, including the password read from App config |
| `src/integrations/cache.test.ts` | The KV variant against a real Redis container: text round trip, missing key as `null`, prefix, expiry and client reuse |
| `src/blocks/email/send.test.ts` | `runBlock` with a fake integration client |

```sh
bun test        # the Redis test starts a container
bun run build   # writes fluxify-examples-integrations-1.0.0.tgz
```

The guide that explains all of this is in [`docs/plugins/authoring/integrations`](../../../docs/plugins/authoring/integrations.md).
