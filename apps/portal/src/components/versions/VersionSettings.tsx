import { Chip, SchemaEditor, type ValidationSchema } from "@fluxify/components";
import type { CustomBlockUsage } from "@fluxify/server/src/db/schema";
import type { CustomBlockInputParam } from "@/components/canvas/panel/blocks/CustomBlockSettings";
import { Section } from "@/components/common/Section";
import { usageLabel } from "@/components/customBlocks/UsageField";
import { describesSomething, EMPTY_SCHEMA } from "@/components/routes/routeForm";
import { middlewaresQuery } from "@/query/middlewaresQuery";
import type { VersionKind } from "@/services/versions";

type Settings = Record<string, unknown>;
type Phase = { before?: string[]; after?: string[] };

const noop = () => undefined;

function Schema({ title, value }: { title: string; value: unknown }) {
	const schema = (value ?? EMPTY_SCHEMA) as ValidationSchema;
	return (
		<Section title={title} description={describesSomething(schema) ? "" : "None."}>
			{describesSomething(schema) && (
				<SchemaEditor value={schema} onChange={noop} isReadOnly showRootTypeSelector={false} />
			)}
		</Section>
	);
}

function MiddlewareNames({ projectId, ids }: { projectId: string; ids: string[] }) {
	const { data } = middlewaresQuery.getAll.useQuery(projectId);
	if (ids.length === 0) return <p className="text-xs text-muted">None.</p>;
	const names = new Map((data ?? []).map((m) => [m.id, m.name]));
	return (
		<ol className="flex flex-col gap-1 text-xs">
			{ids.map((id, position) => (
				<li key={id} className="flex items-center gap-2">
					<span className="text-muted">{position + 1}.</span>
					<span>{names.get(id) ?? "Deleted middleware"}</span>
				</li>
			))}
		</ol>
	);
}

/**
 * What a version holds besides its blocks (#738): the route's path, method,
 * schemas, timeout and middlewares, a workflow's timeout, or a custom block's
 * inputs and usage. Not the live name or switches, which no version keeps. A
 * middleware's chain is the version itself, shown in the middle pane.
 */
export function VersionSettings({
	kind,
	projectId,
	settings,
}: {
	kind: VersionKind;
	projectId: string;
	settings: Settings;
}) {
	const middlewares = (settings.middlewares ?? {}) as Phase;
	const params = Array.isArray(settings.inputParams)
		? (settings.inputParams as CustomBlockInputParam[])
		: [];
	return (
		<section className="p-4" aria-label="Version settings">
			{kind === "route" && (
				<Section title="Endpoint" description="What clients called at this version.">
					<p className="flex items-center gap-2 font-mono text-xs">
						<Chip size="sm">{String(settings.method ?? "").toUpperCase()}</Chip>
						<span className="truncate">{String(settings.path ?? "")}</span>
					</p>
				</Section>
			)}
			{kind === "route" && (
				<>
					<Schema title="Path params" value={settings.paramsSchema} />
					<Schema title="Query string" value={settings.querySchema} />
					<Schema title="Request body" value={settings.bodySchema} />
				</>
			)}
			{(kind === "route" || kind === "workflow") && (
				<Section title="Timeout" description="Requests running longer are aborted.">
					<p className="text-xs">{String(settings.timeoutSeconds ?? "—")} seconds</p>
				</Section>
			)}
			{kind === "custom_block" && (
				<>
					<Section title="Used for" description="Where this block may be placed.">
						<p className="text-xs">{usageLabel(settings.usage as CustomBlockUsage)}</p>
					</Section>
					<Section title="Input parameters" description={params.length ? "" : "None."}>
						{params.length > 0 && (
							<ol className="flex flex-col gap-1 text-xs">
								{params.map((param) => (
									<li key={param.name} className="flex items-center gap-2">
										<span className="font-mono text-muted">{param.name}</span>
										<span>{param.label}</span>
									</li>
								))}
							</ol>
						)}
					</Section>
				</>
			)}
			{kind === "route" && (
				<>
					<Section title="Middlewares before" description="Run before the route's own flow.">
						<MiddlewareNames projectId={projectId} ids={middlewares.before ?? []} />
					</Section>
					<Section title="Middlewares after" description="Run after the route, on the reply.">
						<MiddlewareNames projectId={projectId} ids={middlewares.after ?? []} />
					</Section>
				</>
			)}
		</section>
	);
}
