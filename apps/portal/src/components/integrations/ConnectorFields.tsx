import type { ComponentProps } from "react";
import { AiForm } from "./connectors/AiForm";
import { CredentialsUrlForm } from "./connectors/CredentialsUrlForm";
import { KafkaForm } from "./connectors/KafkaForm";
import { NatsForm } from "./connectors/NatsForm";
import { ObservabilityForm } from "./connectors/ObservabilityForm";
import { SqsForm } from "./connectors/SqsForm";

const CRED_PLACEHOLDERS: Record<
	string,
	{ ph: Record<string, string>; ssl?: boolean; db?: boolean; dbLabel?: string }
> = {
	PostgreSQL: {
		ph: {
			name: "My Postgres Database",
			host: "postgres.company.com",
			port: "5432",
			username: "postgres",
			password: "secret",
			database: "ecommerce",
			url: "postgres://user:pass@host:port/dbname?ssl=disable",
		},
		ssl: true,
		db: true,
	},
	MySQL: {
		ph: {
			name: "My MySQL Database",
			host: "mysql.company.com",
			port: "3306",
			username: "root",
			password: "secret",
			database: "ecommerce",
			url: "mysql://user:pass@host:port/dbname?ssl=disable",
		},
		db: true,
	},
	MongoDB: {
		ph: {
			name: "My MongoDB Database",
			host: "localhost",
			port: "27017",
			username: "mongo_user",
			password: "secret",
			database: "mydatabase",
			url: "mongodb://user:pass@host:port/dbname",
		},
		db: true,
	},
	Redis: {
		ph: {
			name: "My Redis Cache",
			host: "redis.company.com",
			port: "6379",
			username: "default",
			password: "secret",
			url: "redis://user:pass@host:port/0",
			database: "0",
		},
		db: true,
		dbLabel: "DB Index",
	},
	Memcached: {
		ph: {
			name: "My Memcached Instance",
			host: "memcached.company.com",
			port: "11211",
			username: "default",
			password: "secret",
			url: "memcached://user:pass@host:port",
			database: "",
		},
		db: false,
	},
};

export function setPath(obj: Record<string, unknown>, path: string, value: unknown) {
	const keys = path.split(".");
	const next = structuredClone(obj);
	let current: Record<string, unknown> = next;
	for (let index = 0; index < keys.length - 1; index += 1) {
		const key = keys[index];
		if (typeof current[key] !== "object" || current[key] === null) current[key] = {};
		current = current[key] as Record<string, unknown>;
	}
	current[keys[keys.length - 1]] = value;
	return next;
}

/** The connection form for one connector, used to create and to edit. */
export function ConnectorFields({
	group,
	variant,
	...formProps
}: ComponentProps<typeof KafkaForm> & { group: string; variant: string }) {
	return (
		<>
			{group === "database" && CRED_PLACEHOLDERS[variant] && (
				<CredentialsUrlForm
					{...formProps}
					placeholders={CRED_PLACEHOLDERS[variant].ph as never}
					hasDatabase={CRED_PLACEHOLDERS[variant].db}
					hasSSL={CRED_PLACEHOLDERS[variant].ssl}
					hasQueryTimeout
				/>
			)}
			{group === "kv" && CRED_PLACEHOLDERS[variant] && (
				<CredentialsUrlForm
					{...formProps}
					placeholders={CRED_PLACEHOLDERS[variant].ph as never}
					hasDatabase={CRED_PLACEHOLDERS[variant].db}
					databaseLabel={CRED_PLACEHOLDERS[variant].dbLabel}
				/>
			)}
			{group === "ai" && <AiForm {...formProps} showBaseUrl={variant === "OpenAI Compatible"} />}
			{group === "observability" && variant === "Loki" && (
				<ObservabilityForm
					{...formProps}
					namePlaceholder="Loki | Production"
					baseUrlPlaceholder="http://loki:3100"
					baseUrlDescription="Base URL of the Loki instance"
				/>
			)}
			{group === "observability" && variant === "Open Telemetry" && (
				<ObservabilityForm
					{...formProps}
					supportsGrpc
					namePlaceholder="OpenTelemetry | Production"
					baseUrlPlaceholder="https://http-intake.logs.datadoghq.com/api/v2/logs"
					baseUrlDescription="Base URL of the OTLP endpoint, without the /v1/... path (OpenObserve, Datadog, Grafana, BetterStack)"
				/>
			)}
			{group === "queue" && variant === "Kafka" && <KafkaForm {...formProps} />}
			{group === "queue" && variant === "NATS" && <NatsForm {...formProps} />}
			{group === "queue" && variant === "SQS" && <SqsForm {...formProps} />}
		</>
	);
}
