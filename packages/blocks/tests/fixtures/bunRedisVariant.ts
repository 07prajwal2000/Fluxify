// A plugin's KV variant, as an author writes it: Bun's own Redis client behind
// the kv contract, its password an app config key. Built and registered by
// `pluginIntegration.test.ts`.
import { param } from "@fluxify/sdk/blocks";
import { integration } from "@fluxify/sdk/integrations";
import { RedisClient } from "bun";

export const seen = { connects: 0, closes: 0 };

export default integration({
	name: "acme/demo/bun-redis",
	label: "Bun Redis",
	icon: "./icons/redis.svg",
	group: "kv",
	variant: "Bun Redis",
	config: {
		host: param.string({ required: true }),
		port: param.number({ required: true }),
		password: param.secret({ required: true }),
	},
	async connect(config, ctx) {
		seen.connects++;
		const password = encodeURIComponent(ctx.getConfig(config.password));
		const client = new RedisClient(`redis://:${password}@${config.host}:${config.port}`);
		await client.connect();
		return {
			get: (key: string) => client.get(key),
			set: async (key: string, value: string) => void (await client.set(key, value)),
			setex: async (key: string, seconds: number, value: string) =>
				void (await client.send("SET", [key, value, "EX", String(seconds)])),
			delete: async (key: string) => void (await client.del(key)),
			getConnection: () => client,
		};
	},
	close(client) {
		seen.closes++;
		client.getConnection().close();
	},
	async test(client) {
		await client.get("fluxify:ping");
		return { success: true };
	},
});
