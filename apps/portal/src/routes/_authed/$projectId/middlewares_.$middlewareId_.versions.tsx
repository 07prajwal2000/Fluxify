import { Button, toast } from "@fluxify/components";
import { createFileRoute, isRedirect, redirect } from "@tanstack/react-router";
import { useState } from "react";
import {
	TbArrowLeft,
	TbLayoutSidebarRightCollapse,
	TbLayoutSidebarRightExpand,
} from "react-icons/tb";
import { z } from "zod";
import { RouteWorkbenchHeader } from "@/components/routes/RouteWorkbenchTabs";
import { ProductionChip } from "@/components/versions/ProductionChip";
import { VersionHistory, type VersionTab } from "@/components/versions/VersionHistory";
import { createRouteHead, usePageTitle } from "@/lib/seo";
import { middlewaresQuery } from "@/query/middlewaresQuery";
import { middlewaresService } from "@/services/middlewares";

export const Route = createFileRoute("/_authed/$projectId/middlewares_/$middlewareId_/versions")({
	head: createRouteHead(
		"Middleware Versions | Middlewares",
		"Look back through the saved versions of a middleware and promote one.",
	),
	validateSearch: z.object({
		tab: z.enum(["versions", "production"]).optional().catch(undefined),
		version: z.string().optional(),
	}),
	beforeLoad: async ({ params, context }) => {
		try {
			const middleware = await context.queryClient.ensureQueryData({
				queryKey: ["middlewares", params.middlewareId, "by-id"],
				queryFn: () => middlewaresService.get(params.middlewareId),
			});
			if (!middleware || middleware.projectId !== params.projectId) {
				toast.danger("Middleware not found");
				throw redirect({
					to: "/$projectId/middlewares",
					params: { projectId: params.projectId },
				});
			}
		} catch (err) {
			if (isRedirect(err)) throw err;
			toast.danger("Middleware not found");
			throw redirect({
				to: "/$projectId/middlewares",
				params: { projectId: params.projectId },
			});
		}
	},
	component: MiddlewareVersionsPage,
});

function MiddlewareVersionsPage() {
	const { projectId, middlewareId } = Route.useParams();
	const { tab: tabParam, version } = Route.useSearch();
	const tab = tabParam ?? "versions";
	const navigate = Route.useNavigate();
	const { data: middleware } = middlewaresQuery.get.useQuery(middlewareId);
	const [settingsOpen, setSettingsOpen] = useState(true);
	usePageTitle(middleware ? `${middleware.name} | Versions` : "Middleware Versions | Middlewares");

	return (
		<div className="flex h-screen w-full flex-col">
			<RouteWorkbenchHeader>
				<Button
					variant="ghost"
					size="sm"
					onPress={() =>
						navigate({
							to: "/$projectId/middlewares/$middlewareId",
							params: { projectId, middlewareId },
						})
					}
				>
					<TbArrowLeft size={14} /> Middlewares
				</Button>
				<span className="font-medium">{middleware?.name ?? "Middleware"}</span>
				<div className="ml-auto flex items-center gap-2">
					<ProductionChip kind="middleware" id={middlewareId} projectId={projectId} />
					<Button
						isIconOnly
						variant="ghost"
						size="sm"
						aria-label={settingsOpen ? "Hide version settings" : "Show version settings"}
						onPress={() => setSettingsOpen((open) => !open)}
					>
						{settingsOpen ? (
							<TbLayoutSidebarRightCollapse size={16} />
						) : (
							<TbLayoutSidebarRightExpand size={16} />
						)}
					</Button>
				</div>
			</RouteWorkbenchHeader>
			<VersionHistory
				key={middlewareId}
				kind="middleware"
				id={middlewareId}
				projectId={projectId}
				tab={tab}
				onTabChange={(next: VersionTab) =>
					navigate({ search: (prev) => ({ ...prev, tab: next }), replace: true })
				}
				settingsOpen={settingsOpen}
				onBackToCanvas={() =>
					navigate({
						to: "/$projectId/middlewares/$middlewareId",
						params: { projectId, middlewareId },
					})
				}
				onOpenSandbox={() => undefined}
				initialVersionId={version}
			/>
		</div>
	);
}
