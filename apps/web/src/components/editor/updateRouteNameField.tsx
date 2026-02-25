"use client";
import { routesQueries } from "@/query/routerQuery";
import {
	Breadcrumbs,
	Button,
	Loader,
	TextInput,
	Menu,
	ActionIcon,
	Group,
	Flex,
	Text,
} from "@mantine/core";
import { useParams, useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";
import QueryLoader from "../query/queryLoader";
import { routesService } from "@/services/routes";
import { useDebouncedCallback } from "@mantine/hooks";
import { useQueryClient } from "@tanstack/react-query";
import { showErrorNotification } from "@/lib/errorNotifier";
import { notifications } from "@mantine/notifications";
import { TbUser, TbStack2, TbChevronDown } from "react-icons/tb";
import { useAuthStore } from "@/store/auth";
import { roleHierarchy } from "@fluxify/server/src/lib/acl";
import Link from "next/link";
import HttpMethodText from "../httpMethodText";

const UpdateRouteNameField = () => {
	const { id } = useParams();
	const { useQuery } = routesQueries.getById;
	const { data, isLoading } = useQuery(id?.toString() || "");
	const [name, setName] = React.useState(data?.name || "");
	const queryClient = useQueryClient();
	const [updateLoading, setUpdateLoading] = useState(false);
	const router = useRouter();
	const { acl, userData } = useAuthStore();
	const projectId = data?.projectId || "";
	const canEdit =
		userData.isSystemAdmin ||
		(acl && roleHierarchy[acl[projectId]] >= roleHierarchy["creator"]);

	const { data: routesResponse } = routesQueries.getAll.useQuery({
		page: 1,
		perPage: 100,
		filter: { field: "" as any, operator: "" as any, value: "", projectId },
	});
	const routesData = routesResponse?.data || [];

	const debouncedCallback = useDebouncedCallback(async (value: string) => {
		try {
			const { data: parsed, success } = routesService.createRequestSchema
				.pick({ name: true })
				.safeParse({ name: value });
			if (!success) return;

			await routesService.updatePartial(data?.id!, { name: parsed.name });
			routesQueries.invalidateAll(queryClient);
			notifications.show({
				message: "Route name updated",
				color: "green",
			});
		} catch (error: any) {
			setName(data?.name || "");
			showErrorNotification(error);
		} finally {
			setUpdateLoading(false);
		}
	}, 1200);

	useEffect(() => {
		setName(data?.name || "");
	}, [data?.name]);

	if (isLoading) return <QueryLoader skeletonsCols={1} skeletonsRows={1} />;

	function onChange(e: React.ChangeEvent<HTMLInputElement>) {
		setUpdateLoading(true);
		setName(e.target.value);
		debouncedCallback(e.target.value);
	}

	function onProjectClick() {
		router.push(`/${projectId}`);
	}

	const projectName = data?.projectName;
	const projectIcon = TbStack2;
	return (
		<Breadcrumbs w={"100%"}>
			<Button
				leftSection={projectIcon({ size: 18 })}
				onClick={onProjectClick}
				variant="subtle"
				color="gray"
				size="xs"
			>
				{projectName}
			</Button>
			<Group gap="0" wrap="nowrap" align="center" style={{ flexGrow: 1 }}>
				<TextInput
					disabled={!canEdit}
					size="xs"
					onChange={onChange}
					placeholder="Route Name"
					color="violet"
					value={name}
					rightSection={
						updateLoading ? <Loader size={18} color="violet" /> : ""
					}
					style={{ flexGrow: 1 }}
					styles={{
						input: {
							borderTopRightRadius: 0,
							borderBottomRightRadius: 0,
							borderRight: 0,
						},
					}}
				/>
				<Menu shadow="md" width={250}>
					<Menu.Target>
						<ActionIcon
							variant="default"
							size={30}
							style={{
								borderLeft: 0,
								borderTopLeftRadius: 0,
								borderBottomLeftRadius: 0,
							}}
						>
							<TbChevronDown size={16} />
						</ActionIcon>
					</Menu.Target>
					<Menu.Dropdown>
						{routesData.map((route) => {
							const isActive = route.id === data?.id;

							if (isActive) {
								return (
									<Menu.Item
										key={route.id}
										style={{
											backgroundColor: "var(--mantine-color-violet-light)",
											cursor: "default",
										}}
									>
										<Group wrap="nowrap" gap="xs">
											<HttpMethodText method={route.method as any} small />
											<Text size="sm" fw="600" truncate>
												{route.name}
											</Text>
										</Group>
									</Menu.Item>
								);
							}

							return (
								<Menu.Item
									key={route.id}
									component={Link}
									href={`/editor/${route.id}`}
								>
									<Group wrap="nowrap" gap="xs">
										<HttpMethodText method={route.method as any} small />
										<Text size="sm" fw="normal" truncate>
											{route.name}
										</Text>
									</Group>
								</Menu.Item>
							);
						})}
					</Menu.Dropdown>
				</Menu>
			</Group>
		</Breadcrumbs>
	);
};

export default UpdateRouteNameField;
