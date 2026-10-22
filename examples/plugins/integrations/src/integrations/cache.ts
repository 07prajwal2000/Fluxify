import { param } from "@fluxify/sdk/blocks";
import { integration } from "@fluxify/sdk/integrations";
import { Redis } from "ioredis";

export default integration({
	name: "fluxify-examples/integrations/cache",
	label: "Redis cache",
	description: "A key-value store on Redis, with an optional key prefix.",
	icon: "./icons/cache.svg",
	// a variant of the built-in kv group: the KV blocks can use it unchanged
	group: "kv",
	variant: "Redis Cache",
	docs: `A key-value store on Redis.

## When to use it
Share a cache or a small piece of state between routes, with the KV blocks or a plugin block.

## Connection
| Name | Required | Default |
| :--- | :--- | :--- |
| Connection URL | Yes | an App config key |
| Key prefix | No | none |

## How it behaves
- The URL is read from App config through the key this config names, so the value is never stored on the integration.
- **Key prefix** is put in front of every key the store reads or writes, so two integrations can share one Redis database without colliding.
- Values are text. A missing key reads as \`null\`.
- **Test connection** pings the server.`,
	config: {
		url: param.secret({ label: "Connection URL", required: true }),
		prefix: param.string({
			label: "Key prefix",
			description: "Put in front of every key. Leave it empty to use the keys as written.",
			default: "",
		}),
	},
	// the stored config names the app config key, so rotating its value keeps this pool key
	poolKey: (config) => config.url,
	async connect(config, ctx) {
		const client = new Redis(ctx.getConfig(config.url), {
			connectTimeout: 5000,
			maxRetriesPerRequest: 2,
		});
		const key = (name: string) => `${config.prefix}${name}`;
		const kv = {
			async get(name: string) {
				return (await client.get(key(name))) ?? null;
			},
			async set(name: string, value: string) {
				await client.set(key(name), value);
			},
			async setex(name: string, seconds: number, value: string) {
				await client.setex(key(name), seconds, value);
			},
			async delete(name: string) {
				await client.del(key(name));
			},
			getConnection() {
				return client;
			},
			async disconnect() {
				client.disconnect();
			},
		};
		return kv;
	},
	async test(client) {
		await client.getConnection().ping();
		return { success: true };
	},
	close(client) {
		client.disconnect();
	},
});
