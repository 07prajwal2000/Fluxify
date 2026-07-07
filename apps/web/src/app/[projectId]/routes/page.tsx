"use client";
import React from "react";
import { Stack, Text, Group } from "@mantine/core";
import RoutesPanel from "@/components/panels/routesPanel";
import RouterFilter from "@/components/filters/routerFilter";
import RouterPagination from "@/components/filters/routerPagination";
import CreateNewMenu from "@/components/createNewMenu";
import { useParams } from "next/navigation";

const ProjectRoutesPage = () => {
	const { projectId } = useParams();

	return (
		<Stack style={{ height: "100%" }} p="md" gap="md">
			<Group justify="end" align="center">
				<Group>
					<CreateNewMenu />
					<RouterPagination />
					<RouterFilter />
				</Group>
			</Group>

			<div style={{ flex: 1, overflowY: "auto" }}>
				<RoutesPanel projectId={projectId as string} />
			</div>
		</Stack>
	);
};

export default ProjectRoutesPage;
