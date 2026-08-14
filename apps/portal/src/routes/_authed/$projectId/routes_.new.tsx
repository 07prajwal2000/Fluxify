import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
	Button,
	Checkbox,
	cn,
	Input,
	Label,
	MultiSelect,
	SchemaEditor,
	TextField,
	toast,
	type ValidationSchema,
	type SchemaProperty,
} from "@fluxify/components";
import { TbArrowLeft, TbArrowRight, TbCheck } from "react-icons/tb";
import {
	DEFAULT_CONTENT_TYPES,
	type ContentType,
} from "@fluxify/server/src/lib/routeConfig";
import { ROUTE_REGEX } from "@fluxify/server/src/api/v1/routes/constants";
import { routesQuery } from "@/query/routesQuery";
import { projectSettingsKeysQuery } from "@/query/projectSettingsKeysQuery";
import { showErrorNotification } from "@/lib/errorNotifier";
import { createRouteHead } from "@/lib/seo";
import {
	CONTENT_TYPE_OPTIONS,
	EMPTY_SCHEMA,
	METHODS_WITH_BODY,
	MethodSwitch,
	PARAM_DATA_TYPES,
	QUERY_DATA_TYPES,
	bodyDataTypes,
	bodySchemaFor,
	describesSomething,
	extractPathParams,
	isBinaryBody,
	paramConfigFrom,
	paramsSchemaFrom,
	sanitizePath,
	type Method,
} from "@/components/routes/routeForm";

export const Route = createFileRoute("/_authed/$projectId/routes_/new")({
	head: createRouteHead(
		"New Route",
		"Create an API route: method, path, params and request validation.",
	),
	component: CreateRoutePage,
});

function CreateRoutePage() {
	const { projectId } = Route.useParams();
	const navigate = useNavigate();
	const create = routesQuery.create.mutation();
	const { data: projectSettings } =
		projectSettingsKeysQuery.getAll.useQuery(projectId);

	const settings = (projectSettings ?? {}) as Record<string, string>;
	// Spans go to the project's traces destination; with none set a traced route
	// records nothing, so the toggle is worth flagging rather than hiding.
	const hasTracesDestination = Boolean(
		settings["settings.telemetry.tracesConnectionId"],
	);
	// The per-route timeout is only enforced when the project opted into the
	// experimental worker timeouts, so asking for a value otherwise is a lie.
	const workerTimeoutsEnabled =
		settings["experimental.workerTimeouts.enabled"] === "true";

	const [name, setName] = useState("");
	const [method, setMethod] = useState<Method>("GET");
	const [path, setPath] = useState("");
	const [querySchema, setQuerySchema] = useState<ValidationSchema>(EMPTY_SCHEMA);
	const [bodySchema, setBodySchema] = useState<ValidationSchema>(EMPTY_SCHEMA);
	const [contentTypes, setContentTypes] =
		useState<string[]>(DEFAULT_CONTENT_TYPES);
	const [timeoutSeconds, setTimeoutSeconds] = useState(30);
	const [active, setActive] = useState(true);
	const [tracingEnabled, setTracingEnabled] = useState(false);
	// Configured params survive a path edit: keyed by param name, not position.
	const [paramConfig, setParamConfig] = useState<Record<string, SchemaProperty>>(
		{},
	);
	const [step, setStep] = useState(0);

	const pathParams = useMemo(() => extractPathParams(path), [path]);
	const hasBody = METHODS_WITH_BODY.includes(method);

	const paramsSchema = useMemo(
		() => paramsSchemaFrom(pathParams, paramConfig),
		[pathParams, paramConfig],
	);

	const basicsValid =
		name.trim().length >= 2 && path.length > 0 && ROUTE_REGEX.test(path);

	const steps = useMemo(
		() =>
			[
				{ key: "basics", label: "Basics" },
				pathParams.length > 0 && { key: "params", label: "Path params" },
				{ key: "query", label: "Query" },
				hasBody && { key: "body", label: "Body" },
				{ key: "review", label: "Review" },
			].filter(Boolean) as { key: string; label: string }[],
		[pathParams.length, hasBody],
	);

	// The step list shrinks when the method or path changes; never point past it.
	const current = Math.min(step, steps.length - 1);
	const currentKey = steps[current].key;
	const isLast = current === steps.length - 1;

	function submit() {
		create.mutate(
			{
				name: name.trim(),
				path,
				method,
				projectId,
				active,
				tracingEnabled,
				timeoutSeconds,
				acceptedContentTypes: hasBody
					? (contentTypes as [ContentType, ...ContentType[]])
					: undefined,
				paramsSchema: pathParams.length > 0 ? paramsSchema : undefined,
				querySchema: describesSomething(querySchema) ? querySchema : undefined,
				bodySchema:
					hasBody && describesSomething(bodySchema) ? bodySchema : undefined,
			},
			{
				onSuccess: (created) => {
					toast.success("Route created");
					navigate({
						to: "/$projectId/canvas/$routeId",
						params: { projectId, routeId: created.id },
					});
				},
				onError: (error) => showErrorNotification(error as Error),
			},
		);
	}

	return (
		<div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
			<div className="flex items-center gap-3">
				<Button
					isIconOnly
					variant="ghost"
					aria-label="Back to routes"
					onPress={() => navigate({ to: "/$projectId/routes", params: { projectId } })}
				>
					<TbArrowLeft size={18} />
				</Button>
				<div>
					<h1 className="text-xl font-semibold tracking-tight">Create a route</h1>
					<p className="text-xs text-muted">
						Define the endpoint and how incoming requests are validated.
					</p>
				</div>
			</div>

			<nav aria-label="Route setup steps" className="border-b border-border pb-3">
				<ol className="flex flex-wrap gap-2">
					{steps.map((item, index) => {
						const reachable = index === 0 || basicsValid;
						const complete = index < current;
						return (
							<li key={item.key} className="flex-1">
								<button
									type="button"
									disabled={!reachable}
									onClick={() => setStep(index)}
									aria-current={index === current ? "step" : undefined}
									className={cn(
										"flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-xs font-medium transition-colors",
										reachable
											? index === current
												? "text-foreground"
												: "text-muted hover:bg-surface-secondary hover:text-foreground"
											: "cursor-not-allowed text-muted/50",
									)}
								>
									<span
										className={cn(
											"flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold transition-all",
											complete || index === current
												? "border-accent bg-accent text-accent-foreground"
												: "border-border bg-surface-secondary text-muted",
										)}
									>
										{complete ? <TbCheck size={12} strokeWidth={3} /> : index + 1}
									</span>
									<span className="hidden truncate sm:inline">{item.label}</span>
								</button>
							</li>
						);
					})}
				</ol>
			</nav>

			<div className="min-h-[340px]">
				<StepHeading
					current={current}
					total={steps.length}
					title={
						{
							basics: "Name the endpoint",
							params: "Describe the path parameters",
							query: "Describe the query string",
							body: "Describe the request body",
							review: "Review and create",
						}[currentKey] ?? ""
					}
					description={
						{
							basics: "The method and path clients will call.",
							params:
								"Every :param in the path gets a field. Add or remove them by editing the path.",
							query: "Optional. Fields clients may pass after the ? in the URL.",
							body: "Optional. The shape a request body must have to be accepted.",
							review: "Last look before the route goes live.",
						}[currentKey] ?? ""
					}
				/>

				<div className="mt-4">
					{currentKey === "basics" && (
						<div className="flex flex-col gap-5">
							<TextField isRequired value={name} onChange={setName}>
								<Label>Name</Label>
								<Input placeholder="List users" />
							</TextField>

							<div className="flex flex-col gap-1.5">
								<Label>Method</Label>
								<MethodSwitch value={method} onChange={setMethod} />
							</div>

							<TextField
								isRequired
								value={path}
								onChange={(next) => setPath(sanitizePath(next))}
								isInvalid={path.length > 0 && !ROUTE_REGEX.test(path)}
							>
								<Label>Path</Label>
								<Input placeholder="/users/:id" className="font-mono" />
								<p className="text-xs text-muted">
									Letters, digits, <code className="font-mono">-</code>,{" "}
									<code className="font-mono">/</code> and{" "}
									<code className="font-mono">:param</code> segments.
								</p>
							</TextField>

							{pathParams.length > 0 && (
								<div className="flex flex-wrap items-center gap-2 text-xs text-muted">
									Path parameters:
									{pathParams.map((param) => (
										<span
											key={param}
											className="rounded-full border border-border bg-surface-secondary px-2 py-0.5 font-mono text-[11px] text-accent"
										>
											{param}
										</span>
									))}
								</div>
							)}
						</div>
					)}

					{currentKey === "params" && (
						<SchemaEditor
							value={paramsSchema}
							onChange={(next) => setParamConfig(paramConfigFrom(next))}
							lockKeys
							disableJs
							showRootTypeSelector={false}
							allowedDataTypes={PARAM_DATA_TYPES}
							maxDepth={1}
						/>
					)}

					{currentKey === "query" && (
						<SchemaEditor
							value={querySchema}
							onChange={setQuerySchema}
							showRootTypeSelector={false}
							allowedDataTypes={QUERY_DATA_TYPES}
							maxDepth={2}
						/>
					)}

					{currentKey === "body" && (
						<div className="flex flex-col gap-5">
							<MultiSelect
								label="Accepted content types"
								description="Requests sent with any other content type are rejected."
								options={CONTENT_TYPE_OPTIONS}
								value={contentTypes}
								onChange={(next) => {
									const resolved = next.length > 0 ? next : DEFAULT_CONTENT_TYPES;
									setContentTypes(resolved);
									setBodySchema((schema) => bodySchemaFor(schema, resolved));
								}}
							/>
							<SchemaEditor
								value={bodySchema}
								onChange={setBodySchema}
								allowedRootTypes={isBinaryBody(contentTypes) ? ["blob"] : undefined}
								allowedDataTypes={bodyDataTypes(contentTypes)}
							/>
						</div>
					)}

					{currentKey === "review" && (
						<div className="flex flex-col gap-5">
							<dl className="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2">
								<SummaryItem label="Name" value={name} />
								<SummaryItem label="Endpoint" value={`${method} ${path}`} mono />
								<SummaryItem
									label="Path params"
									value={pathParams.length > 0 ? pathParams.join(", ") : "None"}
								/>
								<SummaryItem
									label="Query fields"
									value={String((querySchema.properties ?? []).length)}
								/>
								{hasBody && (
									<>
										<SummaryItem
											label="Body"
											value={
												bodySchema.dataType === "blob"
													? "Binary payload"
													: `${(bodySchema.properties ?? []).length} fields`
											}
										/>
										<SummaryItem
											label="Content types"
											value={contentTypes.join(", ")}
										/>
									</>
								)}
								<SummaryItem
									label="Tracing"
									value={tracingEnabled ? "Enabled" : "Disabled"}
								/>
							</dl>

							{workerTimeoutsEnabled && (
								<TextField
									value={String(timeoutSeconds)}
									onChange={(next) =>
										setTimeoutSeconds(Math.max(30, Number(next) || 30))
									}
								>
									<Label>Timeout (seconds)</Label>
									<Input type="number" min={30} />
									<p className="text-xs text-muted">
										Minimum 30 seconds. Requests running longer are aborted.
									</p>
								</TextField>
							)}

							<div className="flex flex-col gap-1.5">
								<Checkbox
									isSelected={tracingEnabled}
									onChange={setTracingEnabled}
									label="Enable request tracing"
									description="Each request is recorded as an OpenTelemetry trace and exported to the project's traces destination — nothing is stored here. Exporting costs time per request: leave it off when latency is the priority, turn it on when you want visibility into what a request did."
								/>
								{!hasTracesDestination && (
									<p className="text-xs text-warning">
										This project has no traces destination yet, so traced
										requests record no spans. Set one under Settings →
										Telemetry.
									</p>
								)}
							</div>

							<Checkbox
								isSelected={active}
								onChange={setActive}
								label="Enable this route immediately"
								description="A disabled route returns 404 until you turn it on."
							/>
						</div>
					)}
				</div>
			</div>

			<div className="flex items-center justify-between border-t border-border pt-3.5">
				<Button
					variant="ghost"
					size="sm"
					isDisabled={current === 0}
					onPress={() => setStep(current - 1)}
				>
					<TbArrowLeft size={16} /> Back
				</Button>
				{isLast ? (
					<Button
						variant="primary"
						size="sm"
						isPending={create.isPending}
						isDisabled={!basicsValid}
						onPress={submit}
					>
						Create route
					</Button>
				) : (
					<Button
						variant="primary"
						size="sm"
						isDisabled={!basicsValid}
						onPress={() => setStep(current + 1)}
					>
						Next <TbArrowRight size={16} />
					</Button>
				)}
			</div>
		</div>
	);
}

function StepHeading({
	current,
	total,
	title,
	description,
}: {
	current: number;
	total: number;
	title: string;
	description: string;
}) {
	return (
		<div>
			<p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
				Step {current + 1} of {total}
			</p>
			<h2 className="mt-1 text-lg font-semibold tracking-tight text-foreground">
				{title}
			</h2>
			<p className="mt-0.5 text-xs text-muted">{description}</p>
		</div>
	);
}

function SummaryItem({
	label,
	value,
	mono,
}: {
	label: string;
	value: string;
	mono?: boolean;
}) {
	return (
		<div className="bg-surface px-3 py-2">
			<dt className="text-[11px] uppercase tracking-wide text-muted">
				{label}
			</dt>
			<dd className={cn("mt-0.5 text-sm text-foreground", mono && "font-mono")}>
				{value || "—"}
			</dd>
		</div>
	);
}
