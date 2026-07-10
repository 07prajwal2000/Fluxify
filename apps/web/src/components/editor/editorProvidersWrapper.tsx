"use client";

import React, { useMemo } from "react";
import { CanvasStoreProvider } from "@/store/canvas";
import { BlockDataStoreProvider } from "@/store/blockDataStore";
import { FlowEditorFeatures, FlowEditorProvider } from "./flowEditor/flowEditorContext";
import { useParams } from "next/navigation";
import { routesQueries } from "@/query/routerQuery";
import QueryLoader from "../query/queryLoader";
import QueryError from "../query/queryError";
import { useAuthStore } from "@/store/auth";
import { canAccess } from "@fluxify/server/src/lib/acl";

const defaultFeatures: FlowEditorFeatures = {
	undoRedo: true,
	zoomPanel: true,
	addBlockSidebar: true,
	stickyNoteBtn: true,
	aiAssistant: true,
	keyboardAccessibility: true,
};

const EditorProvidersWrapper = ({ children }: { children: React.ReactNode }) => {
	const { id } = useParams<{ id: string }>();
	const { useQuery } = routesQueries.getCanvasItems;
	const { data: itemsData, isLoading: itemsLoading, isError: itemsError, error: itemsErrorData, refetch: refetchItems } = useQuery(id);
	const { data: routeData, isLoading: routeLoading } = routesQueries.getById.useQuery(id);
	const { acl, userData } = useAuthStore();

	if (itemsLoading || routeLoading) {
		return <QueryLoader type="spinner" />;
	}

	if (itemsError) {
		return <QueryError error={itemsErrorData} refetcher={refetchItems} />;
	}

	if (!itemsData || !routeData) {
		return null;
	}

	const projectId = routeData.projectId;
	const userRole = acl[projectId] || acl["*"];
	const readonly = userData?.isSystemAdmin ? false : (userRole ? !canAccess(userRole, "creator") : true);

	const initialBlockData = itemsData.blocks.reduce((acc, block) => {
		acc[block.id] = block.data;
		return acc;
	}, {} as Record<string, any>);

	const initialEdges = itemsData.edges.map((edge) => ({
		id: edge.id,
		source: edge.from,
		target: edge.to,
		sourceHandle: edge.fromHandle,
		targetHandle: edge.toHandle,
		type: "custom",
	}));

	return (
		<FlowEditorProvider
			value={{
				readonly,
				routeId: id,
				projectId,
				features: defaultFeatures,
			}}
		>
			<CanvasStoreProvider
				initialBlocks={itemsData.blocks as any}
				initialEdges={initialEdges}
			>
				<BlockDataStoreProvider initialBlockData={initialBlockData}>
					{children}
				</BlockDataStoreProvider>
			</CanvasStoreProvider>
		</FlowEditorProvider>
	);
};

export default EditorProvidersWrapper;
