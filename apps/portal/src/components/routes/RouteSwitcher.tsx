import { useNavigate } from "@tanstack/react-router";
import { routesQuery } from "@/query/routesQuery";
import { EntitySwitcher } from "@/components/common/EntitySwitcher";

const METHOD_COLOR: Record<string, string> = {
	GET: "text-accent",
	POST: "text-success",
	PUT: "text-warning",
	DELETE: "text-danger",
};

function MethodTag({ method }: { method: string }) {
	return (
		<span className={`font-mono text-[11px] font-semibold ${METHOD_COLOR[method] ?? "text-muted"}`}>
			{method}
		</span>
	);
}

/** The shared canvas header nav, filled with this project's routes. */
export function RouteSwitcher({
	projectId,
	routeId,
}: {
	projectId: string;
	routeId: string;
}) {
	const navigate = useNavigate();
	// 50 is the server's max perPage. Past that the switcher only walks the first
	// page — the list screen is the way to reach the rest.
	const { data, isLoading } = routesQuery.getAll.useQuery({ projectId, perPage: 50 });
	const byId = routesQuery.byId.useQuery(routeId);
	const listed = data?.data ?? [];
	// The open route can sit past page 1; keep it selectable either way.
	const routes = listed.some((route) => route.id === routeId) || !byId.data
		? listed
		: [{ ...byId.data, name: byId.data.name ?? null }, ...listed];

	return (
		<EntitySwitcher
			backLabel="Routes"
			noun="route"
			currentId={routeId}
			isLoading={isLoading}
			hasMore={Boolean(data?.pagination?.hasNext)}
			onBack={() => navigate({ to: "/$projectId/routes", params: { projectId } })}
			onSelect={(id) =>
				navigate({ to: "/$projectId/canvas/$routeId", params: { projectId, routeId: id } })
			}
			items={routes.map((route) => ({
				id: route.id,
				textValue: `${route.method} ${route.path}`,
				label: (
					<span className="flex min-w-0 items-center gap-2">
						<MethodTag method={route.method ?? "—"} />
						<span className="truncate font-mono text-xs">{route.path}</span>
						{route.name && <span className="truncate text-xs text-muted">{route.name}</span>}
					</span>
				),
			}))}
		/>
	);
}
