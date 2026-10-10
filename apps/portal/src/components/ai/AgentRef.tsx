import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { Children, type ReactNode } from "react";
import {
	TbBolt,
	TbBox,
	TbCloudCog,
	TbFlask,
	TbLayersIntersect,
	TbRoute,
	TbSquareKey,
	TbStack2,
} from "react-icons/tb";
import { testSuitesService } from "@/services/testSuites";
import { isRefType, type RefType, refPath } from "./agentRefs";

export const REF_ICONS: Record<RefType, typeof TbBox> = {
	route: TbStack2,
	workflow: TbRoute,
	trigger: TbBolt,
	custom_block: TbBox,
	middleware: TbLayersIntersect,
	integration: TbCloudCog,
	app_config: TbSquareKey,
	test_suite: TbFlask,
};

export const CHIP =
	"mx-0.5 inline-flex items-center gap-1 rounded-md border border-accent/20 bg-accent/10 px-2 py-0.5 align-baseline text-xs font-medium text-accent";

/** Text of directive children (the label), whatever markdown wrapped it. */
const textOf = (node: ReactNode): string =>
	Children.toArray(node)
		.map((c) =>
			typeof c === "string" || typeof c === "number"
				? String(c)
				: c && typeof c === "object" && "props" in c
					? textOf((c.props as { children?: ReactNode }).children)
					: "",
		)
		.join("");

/** The tests page a suite belongs to is only known once the suite is read. */
export function useSuiteTarget(id: string, enabled: boolean) {
	return useQuery({
		queryKey: ["agent-ref", "test_suite", id],
		queryFn: () => testSuitesService.getById(id),
		enabled,
		retry: false,
		staleTime: 5 * 60_000,
		refetchOnWindowFocus: false,
	});
}

/**
 * A resource the agent or the user referenced: icon + label that opens the
 * resource's page in a new tab. A ref that is unknown, incomplete or points at
 * nothing that exists renders as its plain label, never an error.
 */
export function AgentRef({
	type,
	id,
	query,
	children,
}: {
	type?: string;
	id?: string | number;
	/** What an app config link searches for; its label by default. */
	query?: string;
	children?: ReactNode;
}) {
	const { projectId } = useParams({ strict: false }) as { projectId?: string };
	const label = textOf(children).trim();
	const ok = isRefType(type) && id !== undefined && String(id) !== "" && Boolean(projectId);
	const suite = useSuiteTarget(String(id), ok && type === "test_suite");
	if (!ok || !projectId) return <>{children}</>;
	if (type === "test_suite" && suite.isError) return <>{children}</>;

	const path = refPath(projectId, type, String(id), suite.data);
	const Icon = REF_ICONS[type];
	const body = (
		<>
			<Icon size={13} className="shrink-0" />
			<span>{label || type.replace("_", " ")}</span>
		</>
	);
	if (!path) return <span className={CHIP}>{body}</span>;
	return (
		<Link
			to={path}
			search={type === "app_config" ? ({ q: query ?? label } as never) : undefined}
			target="_blank"
			rel="noopener noreferrer"
			className={`${CHIP} no-underline transition-colors hover:bg-accent/20`}
			title={`Open ${type.replace("_", " ")} in a new tab`}
		>
			{body}
		</Link>
	);
}

/** The old `:resource{type=… identifier=… name=…}` of earlier messages, drawn as a ref. */
export function LegacyResource({
	type,
	identifier,
	name,
}: {
	type?: string;
	identifier?: string;
	name?: string;
}) {
	return (
		<AgentRef type={type} id={identifier}>
			{name ?? type}
		</AgentRef>
	);
}

/** The markdown element map for ref directives (`remarkDirectiveRehype` names them `ai-<directive>`). */
export const refComponents = { "ai-ref": AgentRef, "ai-resource": LegacyResource };
