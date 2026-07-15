"use client";

import React, { useEffect, useMemo } from "react";
import { CanvasStoreProvider } from "@/store/canvas";
import { BlockDataStoreProvider } from "@/store/blockDataStore";
import { FlowEditorFeatures, FlowEditorProvider } from "./flowEditor/flowEditorContext";
import { useParams, useRouter } from "next/navigation";
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
	const { routeId } = useParams<{ routeId: string }>();
	const router = useRouter();
	const { useQuery } = routesQueries.getCanvasItems;
	const { data: itemsData, isLoading: itemsLoading, isError: itemsError, error: itemsErrorData, refetch: refetchItems } = useQuery(routeId);
	const { data: routeData, isLoading: routeLoading, isError: routeError, error: routeErrorData } = routesQueries.getById.useQuery(routeId);
	const { acl, userData } = useAuthStore();

	useEffect(() => {
		if (routeError || itemsError) {
			const err = (routeErrorData || itemsErrorData) as any;
			const status = err?.response?.status || err?.status;
			if (status === 404) {
				const errorData = err?.response?.data || err?.data;
				if (errorData?.projectId) {
					router.replace(`/${errorData.projectId}/routes`);
				} else {
					router.replace("/");
				}
			}
		}
	}, [routeError, itemsError, routeErrorData, itemsErrorData, router]);

	if (itemsLoading || routeLoading) {
		return <QueryLoader type="spinner" />;
	}

	if (itemsError) {
		const err = itemsErrorData as any;
		const status = err?.response?.status || err?.status;
		if (status !== 404) {
			return <QueryError error={itemsErrorData} refetcher={refetchItems} />;
		}
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
				readonly: false,
				entityId: routeId,
				entityType: "route",
				projectId: projectId as string,
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
