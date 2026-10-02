/**
 * Integration configs as the addresses KEDA's scalers connect with. Their
 * credentials end up only in a trigger's Secret, never in a ScaledObject.
 */

/** A Redis integration, in either form, as KEDA's scaler addresses it. */
export function redisAddress(
	redis:
		| {
				source: "credentials";
				host: string;
				port: string | number;
				username?: string;
				password?: string;
				database?: string;
		  }
		| { source: "url"; url: string },
) {
	if (redis.source === "credentials")
		return {
			address: `${redis.host}:${redis.port}`,
			username: redis.username || undefined,
			password: redis.password || undefined,
			databaseIndex: redis.database || undefined,
			tls: false,
		};
	const url = new URL(redis.url);
	return {
		address: `${url.hostname}:${url.port || "6379"}`,
		username: decodeURIComponent(url.username) || undefined,
		password: decodeURIComponent(url.password) || undefined,
		databaseIndex: url.pathname.slice(1) || undefined,
		tls: url.protocol === "rediss:",
	};
}

/** A RabbitMQ integration, in either form, as the one URL KEDA's AMQP scaler connects with. */
export function rabbitMqUrl(
	rabbit:
		| {
				source: "credentials";
				host: string;
				port?: string | number;
				username?: string;
				password?: string;
				database?: string;
				useSSL?: boolean;
		  }
		| { source: "url"; url: string },
) {
	if (rabbit.source === "url") return rabbit.url;
	const user = rabbit.username
		? `${encodeURIComponent(rabbit.username)}:${encodeURIComponent(rabbit.password ?? "")}@`
		: "";
	const port = rabbit.port ? `:${rabbit.port}` : "";
	// the default vhost `/` is spelled `%2F` in a URL
	const vhost = encodeURIComponent(rabbit.database || "/");
	return `${rabbit.useSSL ? "amqps" : "amqp"}://${user}${rabbit.host}${port}/${vhost}`;
}
