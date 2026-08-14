import { useNavigate } from "@tanstack/react-router";
import { Button, ListBox, Select, Spinner } from "@fluxify/components";
import { TbChevronLeft, TbChevronRight, TbArrowLeft } from "react-icons/tb";
import { routesQuery } from "@/query/routesQuery";

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

/**
 * Canvas header nav: back to the project's route list, plus a pagination-style
 * stepper that walks the sibling routes with a dropdown of all of them.
 */
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
	const index = routes.findIndex((route) => route.id === routeId);
	const current = index >= 0 ? routes[index] : undefined;
	const hasMore = Boolean(data?.pagination?.hasNext);

	function go(to: string) {
		navigate({ to: "/$projectId/canvas/$routeId", params: { projectId, routeId: to } });
	}

	function step(delta: number) {
		const next = routes[index + delta];
		if (next) go(next.id);
	}

	return (
		<div className="flex min-w-0 items-center gap-2">
			<Button
				variant="ghost"
				size="sm"
				aria-label="Back to routes"
				onPress={() => navigate({ to: "/$projectId/routes", params: { projectId } })}
			>
				<TbArrowLeft size={16} /> Routes
			</Button>

			<span className="h-5 w-px bg-border" />

			{isLoading ? (
				<Spinner size="sm" />
			) : (
				<div className="flex min-w-0 items-center gap-1">
					<Button
						variant="ghost"
						size="sm"
						aria-label="Previous route"
						isDisabled={index <= 0}
						onPress={() => step(-1)}
					>
						<TbChevronLeft size={16} />
					</Button>

					<Select
						aria-label="Switch route"
						selectedKey={current?.id ?? null}
						onSelectionChange={(key) => key && go(key as string)}
						className="min-w-0"
					>
						<Select.Trigger className="min-w-0 max-w-[22rem]">
							<span className="flex min-w-0 items-center gap-2">
								<MethodTag method={current?.method ?? "—"} />
								<span className="truncate font-mono text-xs">
									{current?.path ?? "Unknown route"}
								</span>
							</span>
							<Select.Indicator />
						</Select.Trigger>
						<Select.Popover className="max-h-80 w-[26rem]">
							<ListBox>
								{routes.map((route) => (
									<ListBox.Item
										key={route.id}
										id={route.id}
										textValue={`${route.method} ${route.path}`}
									>
										<span className="flex min-w-0 items-center gap-2">
											<MethodTag method={route.method ?? "—"} />
											<span className="truncate font-mono text-xs">{route.path}</span>
											{route.name && (
												<span className="truncate text-xs text-muted">{route.name}</span>
											)}
										</span>
										<ListBox.ItemIndicator />
									</ListBox.Item>
								))}
							</ListBox>
						</Select.Popover>
					</Select>

					<Button
						variant="ghost"
						size="sm"
						aria-label="Next route"
						isDisabled={index < 0 || index >= routes.length - 1}
						onPress={() => step(1)}
					>
						<TbChevronRight size={16} />
					</Button>

					{index >= 0 && (
						<span className="ml-1 whitespace-nowrap text-xs text-muted">
							{index + 1} / {routes.length}
							{hasMore && "+"}
						</span>
					)}
				</div>
			)}
		</div>
	);
}
