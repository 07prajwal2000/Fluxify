import { useEffect, useMemo, useState } from "react";
import {
	Alert,
	Button,
	Chip,
	Modal,
	Input,
	Label,
	MultiSelect,
	NumberField,
	SchemaEditor,
	Spinner,
	Switch,
	Tabs,
	TextField,
	toast,
	type SchemaProperty,
	type ValidationSchema,
} from "@fluxify/components";
import type { ContentType } from "@fluxify/server/src/lib/routeConfig";
// type-only: the enum's module pulls drizzle in, the type erases at compile
import type { HttpMethod } from "@fluxify/server/src/db/schema";
import { DEFAULT_CONTENT_TYPES } from "@fluxify/server/src/lib/routeConfig";
import { ROUTE_REGEX } from "@fluxify/server/src/api/v1/routes/constants";
import { TbAlertTriangle } from "react-icons/tb";
import { routesQuery } from "@/query/routesQuery";
import { projectSettingsKeysQuery } from "@/query/projectSettingsKeysQuery";
import { showErrorNotification } from "@/lib/errorNotifier";
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
} from "./routeForm";

/**
 * The same settings the create wizard collects, laid out for editing rather
 * than for a first pass: sections reachable in any order and one save for the
 * lot. A wizard is right once; after that the user is here to change one thing
 * and get back to the graph.
 *
 * Near-full-screen — the schema editors need the room — but inset on every side
 * so the canvas stays visible behind it and it still reads as a dialog.
 */
export function RouteSettingsModal({
	routeId,
	isOpen,
	onOpenChange,
}: {
	routeId: string;
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const { data: route, isLoading } = routesQuery.byId.useQuery(routeId);

	return (
		<Modal isOpen={isOpen} onOpenChange={onOpenChange}>
			<Modal.Backdrop>
				<Modal.Container placement="center" size="cover" className="p-0">
					<Modal.Dialog className="flex h-[92vh] w-[94vw] !max-w-none flex-col overflow-hidden border border-border bg-background p-0 shadow-2xl shadow-black/50">
						{isLoading || !route ? (
							<div className="flex h-full items-center justify-center">
								<Spinner />
							</div>
						) : (
							// Remount per route so every field starts from what the server holds.
							<RouteSettingsForm
								key={route.id}
								route={route}
								onSaved={() => onOpenChange(false)}
								onClose={() => onOpenChange(false)}
							/>
						)}
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}

type RouteData = NonNullable<
	ReturnType<typeof routesQuery.byId.useQuery>["data"]
>;

function RouteSettingsForm({
	route,
	onSaved,
	onClose,
}: {
	route: RouteData;
	onSaved: () => void;
	onClose: () => void;
}) {
	const update = routesQuery.update.mutation(route.id);
	const { data: projectSettings } = projectSettingsKeysQuery.getAll.useQuery(
		route.projectId,
	);

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

	const [name, setName] = useState(route.name);
	const [method, setMethod] = useState<Method>(route.method as Method);
	const [path, setPath] = useState(route.path);
	const [querySchema, setQuerySchema] = useState<ValidationSchema>(
		route.querySchema ?? EMPTY_SCHEMA,
	);
	const [bodySchema, setBodySchema] = useState<ValidationSchema>(
		route.bodySchema ?? EMPTY_SCHEMA,
	);
	const [contentTypes, setContentTypes] = useState<string[]>(
		route.acceptedContentTypes.length > 0
			? route.acceptedContentTypes
			: DEFAULT_CONTENT_TYPES,
	);
	const [timeoutSeconds, setTimeoutSeconds] = useState(route.timeoutSeconds);
	const [active, setActive] = useState(route.active);
	const [tracingEnabled, setTracingEnabled] = useState(route.tracingEnabled);
	// Configured params survive a path edit: keyed by param name, not position.
	const [paramConfig, setParamConfig] = useState<Record<string, SchemaProperty>>(
		() => paramConfigFrom(route.paramsSchema),
	);
	const [tab, setTab] = useState("general");

	const pathParams = useMemo(() => extractPathParams(path), [path]);
	const hasBody = METHODS_WITH_BODY.includes(method);
	const paramsSchema = useMemo(
		() => paramsSchemaFrom(pathParams, paramConfig),
		[pathParams, paramConfig],
	);

	const pathIsValid = path.length > 0 && ROUTE_REGEX.test(path);
	const nameIsValid = name.trim().length >= 2;

	const payload = useMemo(
		() => ({
			name: name.trim(),
			path,
			method: method as HttpMethod,
			active,
			tracingEnabled,
			timeoutSeconds,
			acceptedContentTypes: hasBody
				? (contentTypes as [ContentType, ...ContentType[]])
				: undefined,
			// null, not undefined: an omitted field is skipped by the update, which
			// would leave a schema the user just emptied still validating requests.
			paramsSchema: pathParams.length > 0 ? paramsSchema : null,
			querySchema: describesSomething(querySchema) ? querySchema : null,
			bodySchema: hasBody && describesSomething(bodySchema) ? bodySchema : null,
		}),
		[
			name,
			path,
			method,
			active,
			tracingEnabled,
			timeoutSeconds,
			hasBody,
			contentTypes,
			pathParams.length,
			paramsSchema,
			querySchema,
			bodySchema,
		],
	);

	// Stored once from the route as loaded, so "dirty" survives a refetch.
	const [baseline] = useState(() => JSON.stringify(payload));
	const isDirty = JSON.stringify(payload) !== baseline;

	// The tab list shrinks with the method and the path; never sit on a gone tab.
	const tabs = useMemo(
		() =>
			[
				{ id: "general", label: "General" },
				pathParams.length > 0 && { id: "params", label: "Path params" },
				{ id: "query", label: "Query" },
				hasBody && { id: "body", label: "Body" },
				{ id: "advanced", label: "Advanced" },
			].filter(Boolean) as { id: string; label: string }[],
		[pathParams.length, hasBody],
	);
	useEffect(() => {
		if (!tabs.some((item) => item.id === tab)) setTab("general");
	}, [tabs, tab]);

	function save() {
		update.mutate(payload, {
			onSuccess: () => {
				toast.success("Route settings saved");
				onSaved();
			},
			onError: (error) => showErrorNotification(error as Error),
		});
	}

	return (
		<>
			<Modal.Header className="flex shrink-0 flex-row items-center gap-3 border-b border-border px-5 py-3">
				<div className="min-w-0">
					<Modal.Heading className="text-sm font-semibold">
						Route settings
					</Modal.Heading>
					<p className="truncate font-mono text-xs text-muted">
						{method} {path}
					</p>
				</div>
				{/* the trigger renders its own X; a child would sit inside its chrome */}
				<Modal.CloseTrigger
					aria-label="Close route settings"
					className="ml-auto rounded-md bg-transparent p-1.5 text-muted transition-colors hover:bg-white/[0.06] hover:text-foreground"
				/>
			</Modal.Header>

			<Modal.Body className="min-h-0 flex-1 p-0">
				<Tabs
					orientation="vertical"
					selectedKey={tab}
					onSelectionChange={(key) => setTab(String(key))}
					className="flex h-full min-h-0 flex-row"
				>
					<Tabs.List
						aria-label="Route settings sections"
						className="w-44 shrink-0 border-r border-border p-3"
					>
						{tabs.map((item) => (
							<Tabs.Tab key={item.id} id={item.id}>
								{item.label}
							</Tabs.Tab>
						))}
					</Tabs.List>

					<Tabs.Panel id="general" className="min-h-0 flex-1 overflow-y-auto p-5">
						<Section
							title="Endpoint"
							description="What clients call. Changing either re-registers the route."
						>
							<TextField
								isRequired
								value={name}
								onChange={setName}
								isInvalid={!nameIsValid}
							>
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
								isInvalid={path.length > 0 && !pathIsValid}
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
										<Chip key={param} className="font-mono">
											{param}
										</Chip>
									))}
								</div>
							)}
						</Section>

						<Section
							title="Availability"
							description="A disabled route returns 404 until you turn it back on."
						>
							<Switch
								isSelected={active}
								onChange={setActive}
								label={active ? "Route is active" : "Route is disabled"}
							/>
						</Section>
					</Tabs.Panel>

					<Tabs.Panel id="params" className="min-h-0 flex-1 overflow-y-auto p-5">
						<Section
							title="Path parameters"
							description="Every :param in the path gets a field. Add or remove them by editing the path — a declared param is always required."
						>
							<SchemaEditor
								value={paramsSchema}
								onChange={(next) => setParamConfig(paramConfigFrom(next))}
								lockKeys
								disableJs
								showRootTypeSelector={false}
								allowedDataTypes={PARAM_DATA_TYPES}
								maxDepth={1}
							/>
						</Section>
					</Tabs.Panel>

					<Tabs.Panel id="query" className="min-h-0 flex-1 overflow-y-auto p-5">
						<Section
							title="Query string"
							description="Optional. Fields clients may pass after the ? in the URL."
						>
							<SchemaEditor
								value={querySchema}
								onChange={setQuerySchema}
								showRootTypeSelector={false}
								allowedDataTypes={QUERY_DATA_TYPES}
								maxDepth={2}
							/>
						</Section>
					</Tabs.Panel>

					<Tabs.Panel id="body" className="min-h-0 flex-1 overflow-y-auto p-5">
						<Section
							title="Request body"
							description="Optional. The shape a request body must have to be accepted."
						>
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
						</Section>
					</Tabs.Panel>

					<Tabs.Panel id="advanced" className="min-h-0 flex-1 overflow-y-auto p-5">
						<Section
							title="Tracing"
							description="Each request is recorded as an OpenTelemetry trace and exported to the project's traces destination — nothing is stored here. Exporting costs time per request: leave it off when latency is the priority, turn it on when you want visibility into what a request did."
						>
							<Switch
								isSelected={tracingEnabled}
								onChange={setTracingEnabled}
								label={tracingEnabled ? "Tracing enabled" : "Tracing disabled"}
							/>
							{tracingEnabled && !hasTracesDestination && (
								<Alert status="warning">
									<Alert.Indicator>
										<TbAlertTriangle size={16} />
									</Alert.Indicator>
									<Alert.Content>
										<Alert.Title>No traces destination</Alert.Title>
										<Alert.Description>
											This project has no traces integration, so traced requests
											record no spans. Set one under Settings → Telemetry.
										</Alert.Description>
									</Alert.Content>
								</Alert>
							)}
						</Section>

						{workerTimeoutsEnabled && (
							<Section
								title="Timeout"
								description="Minimum 30 seconds. Requests running longer are aborted."
							>
								<NumberField
									value={timeoutSeconds}
									onChange={(next) => setTimeoutSeconds(Math.max(30, next || 30))}
									minValue={30}
								>
									<Label>Timeout (seconds)</Label>
									<NumberField.Group>
										<NumberField.DecrementButton />
										<NumberField.Input />
										<NumberField.IncrementButton />
									</NumberField.Group>
								</NumberField>
							</Section>
						)}
					</Tabs.Panel>
				</Tabs>
			</Modal.Body>

			<Modal.Footer className="flex shrink-0 flex-row items-center gap-3 border-t border-border px-5 py-3">
				<span className="text-xs text-muted">
					{isDirty ? "Unsaved changes" : "All changes saved"}
				</span>
				<div className="ml-auto flex items-center gap-2">
					<Button variant="ghost" onPress={onClose}>
						Cancel
					</Button>
					<Button
						variant="primary"
						isDisabled={!isDirty || !nameIsValid || !pathIsValid}
						isPending={update.isPending}
						onPress={save}
					>
						Save changes
					</Button>
				</div>
			</Modal.Footer>
		</>
	);
}

function Section({
	title,
	description,
	children,
}: {
	title: string;
	description: string;
	children: React.ReactNode;
}) {
	return (
		<section className="mb-6 flex flex-col gap-4 last:mb-0">
			<div>
				<h3 className="text-sm font-semibold text-foreground">{title}</h3>
				<p className="mt-0.5 text-xs text-muted">{description}</p>
			</div>
			{children}
		</section>
	);
}
