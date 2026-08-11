import { useState, type ReactNode } from "react";
import { Button, cn, integrationIcons, toast } from "@fluxify/components";
import {
	FaRobot,
	FaTableList,
} from "react-icons/fa6";
import {
	TbArrowLeft,
	TbCheck,
	TbCloudCog,
	TbDatabase,
	TbHeartRateMonitor,
} from "react-icons/tb";
import {
	getDefaultVariantValue,
	getIntegrationsGroups,
	getIntegrationsVariants,
	getSchema,
	humanReadableConnectorNames,
} from "@fluxify/server/src/api/v1/integrations/helpers";
import { showErrorNotification } from "@/lib/errorNotifier";
import { integrationsQuery } from "@/query/integrationsQuery";
import { AiForm } from "./connectors/AiForm";
import { CredentialsUrlForm } from "./connectors/CredentialsUrlForm";
import { ObservabilityForm } from "./connectors/ObservabilityForm";

type Step = 1 | 2 | 3;

const CRED_PLACEHOLDERS: Record<string, { ph: Record<string, string>; ssl?: boolean; db?: boolean }> = {
	PostgreSQL: { ph: { name: "My Postgres Database", host: "postgres.company.com", port: "5432", username: "postgres", password: "secret", database: "ecommerce", url: "postgres://user:pass@host:port/dbname?ssl=disable" }, ssl: true, db: true },
	MySQL: { ph: { name: "My MySQL Database", host: "mysql.company.com", port: "3306", username: "root", password: "secret", database: "ecommerce", url: "mysql://user:pass@host:port/dbname?ssl=disable" }, db: true },
	MongoDB: { ph: { name: "My MongoDB Database", host: "localhost", port: "27017", username: "mongo_user", password: "secret", database: "mydatabase", url: "mongodb://user:pass@host:port/dbname" }, db: true },
	Redis: { ph: { name: "My Redis Cache", host: "redis.company.com", port: "6379", username: "default", password: "secret", url: "redis://user:pass@host:port", database: "" }, db: false },
	Memcached: { ph: { name: "My Memcached Instance", host: "memcached.company.com", port: "11211", username: "default", password: "secret", url: "memcached://user:pass@host:port", database: "" }, db: false },
};

const GROUP_DETAILS: Record<string, { description: string; icon: ReactNode }> = {
	database: { description: "Connect a production database", icon: <TbDatabase size={22} /> },
	kv: { description: "Connect a cache or key-value store", icon: <FaTableList size={20} /> },
	ai: { description: "Connect an AI provider or compatible endpoint", icon: <FaRobot size={20} /> },
	baas: { description: "Connect a managed backend service", icon: <TbCloudCog size={22} /> },
	observability: { description: "Send logs and telemetry to your stack", icon: <TbHeartRateMonitor size={22} /> },
};

function setPath(obj: Record<string, unknown>, path: string, value: unknown) {
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

export function IntegrationOnboardingForm({ projectId, onSaved }: { projectId: string; onSaved?: () => void }) {
	const create = integrationsQuery.create.mutation(projectId);
	const [step, setStep] = useState<Step>(1);
	const [group, setGroup] = useState("");
	const [variant, setVariant] = useState("");
	const [name, setName] = useState("");
	const [config, setConfig] = useState<Record<string, unknown>>({});

	const groups = getIntegrationsGroups();
	const variants = group ? getIntegrationsVariants(group as never) : [];

	function chooseGroup(nextGroup: string) {
		if (getIntegrationsVariants(nextGroup as never).length === 0) return;
		setGroup(nextGroup);
		setVariant("");
		setName("");
		setConfig({});
		setStep(2);
	}

	function chooseVariant(nextVariant: string) {
		setVariant(nextVariant);
		setName("");
		setConfig((getDefaultVariantValue(nextVariant as never) as Record<string, unknown>) ?? {});
		setStep(3);
	}

	function setField(path: string, value: unknown) {
		setConfig((current) => setPath(current, path, value));
	}

	function goToStep(nextStep: Step) {
		if (nextStep === 2 && !group) return;
		if (nextStep === 3 && !variant) return;
		setStep(nextStep);
	}

	function saveIntegration() {
		const schema = getSchema(group as never, variant as never);
		if (!schema) {
			toast.danger("Invalid connector selection");
			return;
		}
		const parsed = schema.safeParse(config);
		if (!parsed.success) {
			toast.danger(parsed.error.issues[0]?.message ?? "Invalid configuration");
			return;
		}

		create.mutate(
			{ name, group, variant, config: parsed.data } as never,
			{
				onSuccess: () => {
					toast.success("Integration connected");
					onSaved?.();
				},
				onError: (error) => showErrorNotification(error as Error),
			},
		);
	}

	const formProps = { projectId, name, onName: setName, config, setField };
	const groupName = group ? humanReadableConnectorNames[group as keyof typeof humanReadableConnectorNames] : "";

	return (
		<div className="flex min-h-[32rem] flex-col">
			<nav aria-label="Integration setup steps" className="border-b border-[#222733] px-1 pb-5">
				<ol className="grid grid-cols-3 gap-2">
					{([
						[1, "Category"],
						[2, "Provider"],
						[3, "Configure"],
					] as const).map(([number, label]) => {
						const available = number === 1 || (number === 2 && Boolean(group)) || (number === 3 && Boolean(variant));
						const complete = number < step;
						return (
							<li key={number}>
								<button
									type="button"
									disabled={!available}
									onClick={() => goToStep(number)}
									className={cn(
										"flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-medium transition-colors",
										available ? "text-zinc-300 hover:bg-white/[0.04]" : "cursor-not-allowed text-zinc-600",
									)}
								>
									<span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px]", complete || step === number ? "border-[#D0F237] bg-[#D0F237] text-black" : "border-[#343a48] text-zinc-500")}>
										{complete ? <TbCheck size={14} /> : number}
									</span>
									<span className="hidden sm:inline">{label}</span>
								</button>
							</li>
						);
					})}
				</ol>
			</nav>

			<div className="flex-1 py-6">
				{step === 1 && (
					<section aria-labelledby="integration-category-heading">
						<p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#D0F237]">Step 1 of 3</p>
						<h2 id="integration-category-heading" className="mt-2 text-xl font-semibold text-white">What would you like to connect?</h2>
						<p className="mt-1 text-sm text-zinc-400">Choose a category to see the services available to your project.</p>
						<div className="mt-5 grid gap-3 sm:grid-cols-2">
							{groups.map((item) => {
								const detail = GROUP_DETAILS[item] ?? { description: "Connect a service", icon: <TbCloudCog size={22} /> };
								const isAvailable = getIntegrationsVariants(item as never).length > 0;
								return (
									<button key={item} type="button" disabled={!isAvailable} onClick={() => chooseGroup(item)} className={cn("group flex min-h-28 items-start gap-4 rounded-xl border p-4 text-left transition-all", isAvailable ? "border-[#272d3a] bg-[#13161e] hover:-translate-y-0.5 hover:border-[#D0F237]/70 hover:bg-[#171b23] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D0F237]" : "cursor-not-allowed border-[#20242d] bg-[#101218] opacity-50")}>
										<span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[#D0F237]/10 text-[#D0F237] group-hover:bg-[#D0F237] group-hover:text-black">{detail.icon}</span>
										<span>
											<span className="block text-sm font-semibold text-white">{humanReadableConnectorNames[item as keyof typeof humanReadableConnectorNames]}</span>
											<span className="mt-1 block text-xs leading-5 text-zinc-400">{isAvailable ? detail.description : "Coming soon"}</span>
										</span>
									</button>
								);
							})}
						</div>
					</section>
				)}

				{step === 2 && (
					<section aria-labelledby="integration-provider-heading">
						<p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#D0F237]">Step 2 of 3</p>
						<h2 id="integration-provider-heading" className="mt-2 text-xl font-semibold text-white">Choose a {groupName.toLowerCase()} provider</h2>
						<p className="mt-1 text-sm text-zinc-400">Select the service you want to configure.</p>
						<div className="mt-5 grid gap-3 sm:grid-cols-2">
							{variants.map((item) => (
								<button key={item} type="button" onClick={() => chooseVariant(item)} className="group flex min-h-24 items-center gap-4 rounded-xl border border-[#272d3a] bg-[#13161e] p-4 text-left transition-all hover:-translate-y-0.5 hover:border-[#D0F237]/70 hover:bg-[#171b23] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D0F237]">
									<span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-zinc-200 group-hover:bg-[#D0F237] group-hover:text-black">{integrationIcons[item] ?? GROUP_DETAILS[group]?.icon}</span>
									<span className="text-sm font-semibold text-white">{item}</span>
								</button>
							))}
						</div>
					</section>
				)}

				{step === 3 && (
					<section aria-labelledby="integration-configure-heading">
						<div className="flex items-center gap-3">
							<span className="flex size-10 items-center justify-center rounded-xl bg-[#D0F237] text-black">{integrationIcons[variant] ?? GROUP_DETAILS[group]?.icon}</span>
							<div>
								<p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#D0F237]">Step 3 of 3</p>
								<h2 id="integration-configure-heading" className="mt-1 text-xl font-semibold text-white">Configure {variant}</h2>
							</div>
						</div>
						<p className="mt-4 text-sm text-zinc-400">Add the credentials and connection details for this integration.</p>
						<div className="mt-6 rounded-xl border border-[#272d3a] bg-[#13161e] p-4 sm:p-5">
							{group === "database" && CRED_PLACEHOLDERS[variant] && <CredentialsUrlForm {...formProps} placeholders={CRED_PLACEHOLDERS[variant].ph as never} hasDatabase={CRED_PLACEHOLDERS[variant].db} hasSSL={CRED_PLACEHOLDERS[variant].ssl} />}
							{group === "kv" && CRED_PLACEHOLDERS[variant] && <CredentialsUrlForm {...formProps} placeholders={CRED_PLACEHOLDERS[variant].ph as never} hasDatabase={false} />}
							{group === "ai" && <AiForm {...formProps} showBaseUrl={variant === "OpenAI Compatible"} />}
							{group === "observability" && variant === "Loki" && <ObservabilityForm {...formProps} namePlaceholder="Loki | Production" baseUrlPlaceholder="http://loki:3100" baseUrlDescription="Base URL of the Loki instance" />}
							{group === "observability" && variant === "Open Telemetry" && <ObservabilityForm {...formProps} namePlaceholder="OpenTelemetry | Production" baseUrlPlaceholder="https://http-intake.logs.datadoghq.com/api/v2/logs" baseUrlDescription="Base URL of the OTLP endpoint, without the /v1/... path (OpenObserve, Datadog, Grafana, BetterStack)" />}
						</div>
					</section>
				)}
			</div>

			<div className="flex items-center justify-between border-t border-[#222733] pt-5">
				{step > 1 ? <Button variant="ghost" onPress={() => goToStep((step - 1) as Step)}><TbArrowLeft size={16} /> Back</Button> : <span />}
				{step === 3 && <Button variant="primary" isPending={create.isPending} onPress={saveIntegration}>Connect {variant}</Button>}
			</div>
		</div>
	);
}
