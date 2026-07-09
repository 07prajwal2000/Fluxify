"use client";

import { projectSettingsQuery } from "@/query/projectSettingsQuery";
import { Stack, Group, Text, Code } from "@mantine/core";
import { useParams } from "next/navigation";
import QueryLoader from "../query/queryLoader";
import QueryError from "../query/queryError";
import { useQueryClient } from "@tanstack/react-query";
import { TbApi, TbExternalLink, TbCopy, TbCheck } from "react-icons/tb";
import { Card, Flex, ActionIcon, CopyButton, Tooltip } from "@mantine/core";

const ProjectInfo = () => {
	const { projectId } = useParams();
	const client = useQueryClient();
	const projId = projectId!.toString();
	const { data, isLoading, isError, error } =
		projectSettingsQuery.getAll.useQuery(projId);
	const upsertMutation = projectSettingsQuery.upsert.useMutation(
		projId,
		client,
	);
	
	if (isLoading) return <QueryLoader skeletonsCols={2} skeletonsRows={4} />;
	if (isError || !data)
		return (
			<QueryError
				overrideMessage="Failed to load project info"
				refetcher={() => projectSettingsQuery.getAll.invalidate(projId, client)}
				error={error || undefined}
			/>
		);
		
	return (
		<Stack>
			<Stack>
				<Card withBorder radius="md" p="md" shadow="sm">
					<Group justify="space-between">
						<Group gap="sm">
							<TbApi size={24} color="#6c757d" />
							<div>
								<Text fw={500}>OpenAPI Specification</Text>
								<Text size="sm" c="dimmed">
									Access your project's auto-generated OpenAPI spec and UI documentation
								</Text>
							</div>
						</Group>
						<Flex gap="sm">
							<CopyButton value={typeof window !== "undefined" ? `${window.location.origin}/_/admin/api/v1/routes/${projId}/openapi.json` : `/_/admin/api/v1/routes/${projId}/openapi.json`} timeout={2000}>
								{({ copied, copy }) => (
									<Tooltip label={copied ? "Copied JSON URL" : "Copy JSON URL"} withArrow position="top">
										<ActionIcon color={copied ? "teal" : "gray"} variant="light" onClick={copy} size="lg">
											{copied ? <TbCheck size={18} /> : <TbCopy size={18} />}
										</ActionIcon>
									</Tooltip>
								)}
							</CopyButton>
							<Tooltip label="Open interactive UI" withArrow position="top">
								<ActionIcon 
									component="a" 
									href={`/_/admin/ui/${projId}/openapi`} 
									target="_blank" 
									variant="light" 
									color="violet"
									size="lg"
								>
									<TbExternalLink size={18} />
								</ActionIcon>
							</Tooltip>
						</Flex>
					</Group>
				</Card>
			</Stack>
		</Stack>
	);
};

export default ProjectInfo;
