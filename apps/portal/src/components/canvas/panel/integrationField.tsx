import { IntegrationSelector } from "@fluxify/components";
import { parseIntegrationKind, variantAllowed } from "@fluxify/sdk/integrations";
import { Link, useParams } from "@tanstack/react-router";
import { useReactFlow } from "@xyflow/react";
import type { ReactNode } from "react";
import { useCallback, useMemo, useRef, useState } from "react";
import { withBasePath } from "@/constants/routes";
import { customBlocksQuery } from "@/query/customBlocksQuery";
import { integrationService } from "@/services/integrations";
import { useCanvasChanges } from "../changes/ChangesContext";
import type { BlockData } from "../types";
import type { CustomBlockInputParam } from "./blocks/CustomBlockSettings";

/**
 * On a custom block's canvas, the block's own `integration_selector` input
 * parameters are offered alongside the project's integrations. Picking one
 * writes `param:<name>`, which the engine substitutes with whatever the calling
 * block was configured with — so the concrete integration is chosen on the
 * caller's side, not here. `blockId` is only present on the custom block route,
 * which is what keeps this out of route canvases.
 */
function useCustomBlockParamIntegrations(
	projectId: string,
	customBlockId: string | undefined,
	group: string,
) {
	const { data: blocks } = customBlocksQuery.getAll.useQuery(projectId);

	return useMemo(() => {
		if (!customBlockId) return undefined;
		const block = blocks?.find((b) => b.id === customBlockId);
		const params = Array.isArray(block?.inputParams)
			? (block.inputParams as CustomBlockInputParam[])
			: [];
		const matching = params.filter(
			(param) => param.type === "integration_selector" && param.group === group,
		);
		if (matching.length === 0) return undefined;
		return matching.map((param) => ({
			id: `param:${param.name}`,
			name: param.label || param.name,
			group,
			variant: "Input parameter",
			config: {},
			external: true,
			hint: `Set by whoever places this block — the “${param.label || param.name}” input.`,
		}));
	}, [blocks, customBlockId, group]);
}

export type BlockIntegrationFieldProps = {
	blockId: string;
	data: BlockData;
	name: string;
	group?: string;
	/** integrations of other groups also offered, limited to these variants (Redis for Send Message) */
	extraGroups?: { group: string; variants: string[] }[];
	/** variants of `group` left out, e.g. a broker the block cannot use yet */
	excludeVariants?: string[];
	/** only these variants of `group` (a plugin param's `variants`): a saved one of another shows an error */
	variants?: readonly string[];
	label?: ReactNode;
	description?: string;
};

/**
 * An integration selector block setting field backed by IntegrationSelector.
 */
export function BlockIntegrationField({
	blockId,
	data,
	name,
	group = "database",
	extraGroups,
	excludeVariants,
	variants,
	label,
	description,
}: BlockIntegrationFieldProps) {
	const { updateNodeData } = useReactFlow();
	const { enabled: editable } = useCanvasChanges();
	const params = useParams({ strict: false }) as {
		projectId?: string;
		blockId?: string;
	};
	const projectId = params?.projectId ?? "";
	const selectedId = typeof data[name] === "string" ? (data[name] as string) : "";
	const injectedIntegrations = useCustomBlockParamIntegrations(projectId, params?.blockId, group);

	const extraKey = JSON.stringify(extraGroups ?? []);
	const excludeKey = JSON.stringify(excludeVariants ?? []);
	const variantsKey = JSON.stringify(variants ?? null);
	/** the saved one when it is of a variant this field no longer takes */
	const [stale, setStale] = useState<{ id: string; name: string; variant: string }>();
	// read by the loader without reloading the list on every pick
	const selectedRef = useRef(selectedId);
	selectedRef.current = selectedId;
	const loadIntegrations = useCallback(async () => {
		if (!projectId) return [];
		const extras: { group: string; variants: string[] }[] = JSON.parse(extraKey);
		const excluded: string[] = JSON.parse(excludeKey);
		const only: string[] | null = JSON.parse(variantsKey);
		const own = (await integrationService.getAll(projectId, group)) || [];
		const takes = (item: { group: string; variant: string }) =>
			variantAllowed(only ?? undefined, item.group, item.variant);
		const held = own.find((item) => item.id === selectedRef.current);
		setStale(
			held && !takes(held) ? { id: held.id, name: held.name, variant: held.variant } : undefined,
		);
		const lists = await Promise.all([
			own.filter((item) => !excluded.includes(item.variant) && takes(item)),
			...extras.map(async (extra) =>
				((await integrationService.getAll(projectId, extra.group)) || []).filter((item) =>
					extra.variants.includes(item.variant),
				),
			),
		]);
		return lists
			.flatMap((list) => list || [])
			.map((item) => ({
				id: item.id,
				name: item.name,
				group: item.group,
				variant: item.variant,
				config: (item.config ?? {}) as Record<string, unknown>,
				tags: item.tags,
			}));
	}, [projectId, group, extraKey, excludeKey, variantsKey]);
	const shown = stale?.id === selectedId ? stale : undefined;

	const handleTestConnection = useCallback(
		async (id: string) => {
			if (!projectId || !id) return;
			await integrationService.testExistingConnection(projectId, id);
		},
		[projectId],
	);

	const groupParam = group ? `?group=${encodeURIComponent(group)}` : "";
	const openPath = selectedId ? `/${encodeURIComponent(selectedId)}` : groupParam;

	return (
		<IntegrationSelector
			label={label}
			description={description}
			group={group}
			selectedId={selectedId}
			loadIntegrations={loadIntegrations}
			injectedIntegrations={injectedIntegrations}
			readonly={!editable}
			onSelect={(id) => {
				if (!editable) return;
				updateNodeData(blockId, { [name]: id });
			}}
			onTestConnection={projectId ? handleTestConnection : undefined}
			openInNewTabUrl={
				projectId ? withBasePath(`/${projectId}/integrations${openPath}`) : undefined
			}
			errorMessage={
				shown &&
				`"${shown.name}" is ${shown.variant}; this field takes only ${variants?.join(", ")}`
			}
			emptyTitle={variants && `No ${variants.join(" or ")} integration yet`}
			emptyAction={
				projectId && (
					<Link
						to="/$projectId/integrations/new"
						params={{ projectId }}
						search={{ group, ...(variants?.length === 1 && { variant: variants[0] }) }}
						target="_blank"
						className="text-sm font-medium text-accent hover:underline"
					>
						Create {variants ? `a ${variants.join(" or ")}` : "an"} integration
					</Link>
				)
			}
			createIntegrationUrl={
				projectId
					? withBasePath(
							`/${projectId}/integrations/new${group ? `?group=${encodeURIComponent(group)}` : ""}`,
						)
					: undefined
			}
		/>
	);
}

/** a plugin `integration` param's picker: its group, and the variants it takes (`kv/Redis` names one) */
export function integrationParamPicker(param: { kind: string; variants?: readonly string[] }) {
	const parsed = parseIntegrationKind(param.kind);
	const variants = param.variants ?? (parsed?.variant ? [parsed.variant] : undefined);
	return { group: parsed?.group ?? param.kind, variants };
}
