import { cn } from "@fluxify/components";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { TbArrowRight, TbBoxMultiple, TbFlask, TbRoute, TbTopologyStar3 } from "react-icons/tb";
import type { Reference, ReferenceKind } from "@/services/references";

const KIND_ICON: Record<ReferenceKind, ReactNode> = {
	route: <TbRoute size={15} />,
	workflow: <TbTopologyStar3 size={15} />,
	custom_block: <TbBoxMultiple size={15} />,
	middleware: <TbArrowRight size={15} />,
	test_suite: <TbFlask size={15} />,
};

export const KIND_LABEL: Record<ReferenceKind, string> = {
	route: "Route",
	workflow: "Workflow",
	custom_block: "Custom block",
	middleware: "Middleware",
	test_suite: "Test suite",
};

/** The kind's icon, labelled for a screen reader. */
export function KindIcon({ kind }: { kind: ReferenceKind }) {
	return (
		<span role="img" aria-label={KIND_LABEL[kind]} title={KIND_LABEL[kind]} className="text-muted">
			{KIND_ICON[kind]}
		</span>
	);
}

/** Where a row opens: the user itself, or a test suite's own route or workflow. */
export function referenceLink(reference: Reference, projectId: string) {
	if (reference.kind === "test_suite" && reference.target) {
		const { kind, id } = reference.target;
		return kind === "route"
			? { to: "/$projectId/canvas/$routeId/test-suites", params: { projectId, routeId: id } }
			: {
					to: "/$projectId/workflow-canvas/$workflowId/test-suites",
					params: { projectId, workflowId: id },
				};
	}
	if (reference.kind === "route")
		return { to: "/$projectId/canvas/$routeId", params: { projectId, routeId: reference.id } };
	if (reference.kind === "workflow")
		return {
			to: "/$projectId/workflow-canvas/$workflowId",
			params: { projectId, workflowId: reference.id },
		};
	if (reference.kind === "custom_block")
		return {
			to: "/$projectId/custom-block-canvas/$blockId",
			params: { projectId, blockId: reference.id },
		};
	return {
		to: "/$projectId/middlewares/$middlewareId",
		params: { projectId, middlewareId: reference.id },
	};
}

/** the rows "Used by" and a refused delete share (#740) */
export function ReferenceList({
	projectId,
	references,
}: {
	projectId: string;
	references: Reference[];
}) {
	return (
		<ul aria-label="Used by" className="flex flex-col gap-1">
			{references.map((reference) => {
				const link = referenceLink(reference, projectId);
				return (
					<li
						key={`${reference.kind}-${reference.id}-${reference.target?.id ?? ""}`}
						className="flex items-center gap-2 text-xs"
					>
						<KindIcon kind={reference.kind} />
						<Link
							to={link.to as never}
							params={link.params as never}
							className="min-w-0 truncate font-medium text-accent hover:underline"
						>
							{reference.name}
						</Link>
						{reference.inProduction && (
							<span className="shrink-0 rounded-md bg-success/10 px-1.5 py-0.5 text-[11px] font-medium text-success">
								In production
							</span>
						)}
						{reference.inWorkingCopy && (
							<span className="shrink-0 rounded-md bg-accent/10 px-1.5 py-0.5 text-[11px] font-medium text-accent">
								Working copy
							</span>
						)}
					</li>
				);
			})}
		</ul>
	);
}

/** The empty state both doors use. */
export function UsedByEmpty() {
	return <p className={cn("text-xs text-muted")}>Not used anywhere yet.</p>;
}
