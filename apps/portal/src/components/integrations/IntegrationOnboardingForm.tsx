import { useState, type ReactNode } from "react";
import { Button, cn, integrationIcons, toast } from "@fluxify/components";
import {
	FaRobot,
	FaTableList,
} from "react-icons/fa6";
import {
	TbArrowLeft,
	TbBolt,
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
	database: { description: "Connect a production database", icon: <TbDatabase size={20} /> },
	kv: { description: "Connect a cache or key-value store", icon: <FaTableList size={18} /> },
	ai: { description: "Connect an AI provider or compatible endpoint", icon: <FaRobot size={18} /> },
	baas: { description: "Connect a managed backend service", icon: <TbCloudCog size={20} /> },
	observability: { description: "Send logs and telemetry to your stack", icon: <TbHeartRateMonitor size={20} /> },
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
	const test = integrationsQuery.testConnection.mutation(projectId);
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

	function testIntegration() {
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

		test.mutate(
			{ group, variant, config: parsed.data },
			{
				onSuccess: (res) =>
					res?.success ? toast.success("Connection successful") : toast.danger(res?.error ?? "Connection failed"),
				onError: (error) => showErrorNotification(error as Error),
			},
		);
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
		<div className="flex flex-col">
			<nav aria-label="Integration setup steps" className="border-b border-[#1E232F] pb-3">
				<ol className="grid grid-cols-3 gap-2">
					{([
						[1, "Category"],
						[2, "Provider"],
						[3, "Configure"],
					] as const).map(([number, label]) => {
						const available = number === 1 || (number === 2 && Boolean(group)) || (number === 3 && Boolean(variant));
						const complete = number < step;
						const current = step === number;
						return (
							<li key={number}>
								<button
									type="button"
									disabled={!available}
									onClick={() => goToStep(number)}
									className={cn(
										"flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-xs font-medium transition-colors",
										available
											? current
												? "text-white"
												: "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200"
											: "cursor-not-allowed text-zinc-600",
									)}
								>
									<span
										className={cn(
											"flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold transition-all",
											complete || current
												? "border-[#D0F237] bg-[#D0F237] text-black"
												: "border-[#2B313E] bg-[#141720] text-zinc-500",
										)}
									>
										{complete ? <TbCheck size={12} strokeWidth={3} /> : number}
									</span>
									<span className="hidden truncate sm:inline">{label}</span>
								</button>
							</li>
						);
					})}
				</ol>
			</nav>

			<div className="flex min-h-[300px] flex-col justify-start py-4">
				{step === 1 && (
					<section aria-labelledby="integration-category-heading">
						<div>
							<p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#D0F237]">Step 1 of 3</p>
							<h2 id="integration-category-heading" className="mt-1 text-lg font-semibold tracking-tight text-white">
								What would you like to connect?
							</h2>
							<p className="mt-0.5 text-xs text-zinc-400">
								Choose a category to see the services available to your project.
							</p>
						</div>
						<div className="mt-3.5 grid gap-2.5 sm:grid-cols-2">
							{groups.map((item) => {
								const detail = GROUP_DETAILS[item] ?? { description: "Connect a service", icon: <TbCloudCog size={20} /> };
								const isAvailable = getIntegrationsVariants(item as never).length > 0;
								return (
									<button
										key={item}
										type="button"
										disabled={!isAvailable}
										onClick={() => chooseGroup(item)}
										className={cn(
											"group flex items-center gap-3.5 rounded-xl border p-3 text-left transition-all duration-150",
											isAvailable
												? "border-[#232836] bg-[#12151D] hover:border-[#D0F237]/60 hover:bg-[#161B26] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D0F237]"
												: "cursor-not-allowed border-[#1A1D26] bg-[#0E1015]/60 opacity-45",
										)}
									>
										<span
											className={cn(
												"flex size-10 shrink-0 items-center justify-center rounded-lg transition-colors",
												isAvailable
													? "bg-[#D0F237]/10 text-[#D0F237] group-hover:bg-[#D0F237] group-hover:text-black"
													: "bg-white/[0.04] text-zinc-600",
											)}
										>
											{detail.icon}
										</span>
										<span className="min-w-0 flex-1">
											<span className="block truncate text-sm font-semibold text-white">
												{humanReadableConnectorNames[item as keyof typeof humanReadableConnectorNames]}
											</span>
											<span className="mt-0.5 block truncate text-xs text-zinc-400">
												{isAvailable ? detail.description : "Coming soon"}
											</span>
										</span>
									</button>
								);
							})}
						</div>
					</section>
				)}

				{step === 2 && (
					<section aria-labelledby="integration-provider-heading">
						<div>
							<p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#D0F237]">Step 2 of 3</p>
							<h2 id="integration-provider-heading" className="mt-1 text-lg font-semibold tracking-tight text-white">
								Choose a {groupName.toLowerCase()} provider
							</h2>
							<p className="mt-0.5 text-xs text-zinc-400">Select the service you want to configure.</p>
						</div>
						<div className="mt-3.5 grid gap-2.5 sm:grid-cols-2">
							{variants.map((item) => (
								<button
									key={item}
									type="button"
									onClick={() => chooseVariant(item)}
									className="group flex items-center gap-3.5 rounded-xl border border-[#232836] bg-[#12151D] p-3 text-left transition-all duration-150 hover:border-[#D0F237]/60 hover:bg-[#161B26] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D0F237]"
								>
									<span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-zinc-200 transition-colors group-hover:bg-[#D0F237] group-hover:text-black">
										{integrationIcons[item] ?? GROUP_DETAILS[group]?.icon}
									</span>
									<span className="truncate text-sm font-semibold text-white">{item}</span>
								</button>
							))}
						</div>
					</section>
				)}

				{step === 3 && (
					<section aria-labelledby="integration-configure-heading" className="flex flex-1 flex-col">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#D0F237]">Step 3 of 3</p>
								<h2 id="integration-configure-heading" className="mt-1 text-lg font-semibold tracking-tight text-white">
									Configure {variant}
								</h2>
							</div>
							<div className="flex items-center gap-2 rounded-lg border border-[#232836] bg-[#141720] px-3 py-1.5 text-xs text-zinc-300">
								<span className="flex size-4 items-center justify-center text-[#D0F237]">
									{integrationIcons[variant] ?? GROUP_DETAILS[group]?.icon}
								</span>
								<span className="font-medium text-white">{variant}</span>
							</div>
						</div>
						<p className="mt-0.5 text-xs text-zinc-400">Add the connection details and credentials for this service.</p>

						<div className="mt-4 flex-1">
							{group === "database" && CRED_PLACEHOLDERS[variant] && (
								<CredentialsUrlForm
									{...formProps}
									placeholders={CRED_PLACEHOLDERS[variant].ph as never}
									hasDatabase={CRED_PLACEHOLDERS[variant].db}
									hasSSL={CRED_PLACEHOLDERS[variant].ssl}
								/>
							)}
							{group === "kv" && CRED_PLACEHOLDERS[variant] && (
								<CredentialsUrlForm
									{...formProps}
									placeholders={CRED_PLACEHOLDERS[variant].ph as never}
									hasDatabase={false}
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
									namePlaceholder="OpenTelemetry | Production"
									baseUrlPlaceholder="https://http-intake.logs.datadoghq.com/api/v2/logs"
									baseUrlDescription="Base URL of the OTLP endpoint, without the /v1/... path (OpenObserve, Datadog, Grafana, BetterStack)"
								/>
							)}
						</div>
					</section>
				)}
			</div>

			<div className="flex items-center justify-between border-t border-[#1E232F] pt-3.5">
				{step > 1 ? (
					<Button variant="ghost" size="sm" onPress={() => goToStep((step - 1) as Step)}>
						<TbArrowLeft size={16} /> Back
					</Button>
				) : (
					<span />
				)}
				{step === 3 && (
					<div className="flex items-center gap-2">
						<Button
							variant="outline"
							size="sm"
							isPending={test.isPending}
							onPress={testIntegration}
							className="whitespace-nowrap"
						>
							<TbBolt size={14} className="text-[#D0F237]" />
							<span>Test connection</span>
						</Button>
						<Button
							variant="primary"
							size="sm"
							isPending={create.isPending}
							onPress={saveIntegration}
						>
							Connect {variant}
						</Button>
					</div>
				)}
			</div>
		</div>
	);
}
