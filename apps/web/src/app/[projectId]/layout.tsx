"use client";
import React from "react";
import {
	AppShell,
	Group,
	Image,
	Button,
	Stack,
	NavLink,
	ActionIcon,
	Text,
	Burger,
} from "@mantine/core";
import { usePathname, useRouter, useParams } from "next/navigation";
import { useDisclosure } from "@mantine/hooks";
import {
	TbArrowLeft,
	TbSparkles,
	TbStack2,
	TbActivity,
	TbCloudCog,
	TbSquareKey,
	TbSettings,
	TbLayoutSidebarLeftCollapse,
	TbLayoutSidebarLeftExpand,
} from "react-icons/tb";
import { APP_ROUTES } from "@/constants/routes";
import { AuthProvider } from "@/components/auth/authProvider";
import { projectsQuery } from "@/query/projectsQuery";
import ProfileNav from "@/components/homepage/ProfileNav";
import { useAuthStore } from "@/store/auth";
import type { AccessControlRole } from "@fluxify/server";
import RequireRole from "@/components/auth/requireRole";
import { useLayoutStore } from "@/store/layout";

const NewProjectLayout = ({ children }: { children: React.ReactNode }) => {
	const router = useRouter();
	const path = usePathname();
	const { projectId } = useParams();
	const { acl } = useAuthStore();
	const id = projectId as string;
	const { sidebarOpened, toggleSidebar } = useLayoutStore();

	const { data: projectsData } = projectsQuery.getAll.useQuery({
		page: 1,
		perPage: 50,
	});
	const projectName =
		projectsData?.data?.find((p: any) => p.id === id)?.name || "Project";

	const navItems = [
		{
			label: "Fluxify AI",
			icon: <TbSparkles size={20} />,
			href: APP_ROUTES.PROJECT_AI(id),
			requiredRole: "creator" as AccessControlRole,
		},
		{
			label: "Routes",
			icon: <TbStack2 size={20} />,
			href: APP_ROUTES.PROJECT_ROUTES(id),
			requiredRole: "viewer" as AccessControlRole,
		},
		{
			label: "Executions",
			icon: <TbActivity size={20} />,
			href: APP_ROUTES.PROJECT_EXECUTIONS(id),
			requiredRole: "viewer" as AccessControlRole,
		},
		{
			label: "Integrations",
			icon: <TbCloudCog size={20} />,
			href: APP_ROUTES.PROJECT_INTEGRATIONS(id),
			requiredRole: "creator" as AccessControlRole,
		},
		{
			label: "App config",
			icon: <TbSquareKey size={20} />,
			href: APP_ROUTES.PROJECT_APP_CONFIG(id),
			requiredRole: "creator" as AccessControlRole,
		},
	];

	if (path.endsWith("/openapi")) {
		return <>{children}</>;
	}

	return (
		<AppShell
			header={{ height: 60 }}
			navbar={{ 
				width: 250, 
				breakpoint: "sm",
				collapsed: { mobile: !sidebarOpened, desktop: !sidebarOpened }
			}}
			padding="0"
		>
			<AuthProvider>
				<AppShell.Header>
					<Group h="100%" px="md" justify="space-between">
						<Group gap="lg">
							<ActionIcon 
								variant="subtle" 
								color="dark" 
								size="lg" 
								onClick={toggleSidebar} 
							>
								{sidebarOpened ? <TbLayoutSidebarLeftCollapse size={24} /> : <TbLayoutSidebarLeftExpand size={24} />}
							</ActionIcon>
							<Image
								src="/_/admin/ui/logo_title.webp"
								alt="Fluxify Logo"
								h={30}
								w="auto"
							/>
							<Group
								gap="xs"
								px="sm"
								py={4}
								style={{ borderLeft: "1px solid #e0e0e0" }}
							>
								<Text fw={600} size="md">
									{projectName}
								</Text>
								<RequireRole
									projectId={projectId as string}
									requiredRole="creator"
								>
									<ActionIcon
										variant="subtle"
										color="gray"
										size="sm"
										onClick={() => router.push(APP_ROUTES.PROJECT_SETTINGS(id))}
									>
										<TbSettings size={16} />
									</ActionIcon>
								</RequireRole>
							</Group>
						</Group>
						<div>
							<ProfileNav />
						</div>
					</Group>
				</AppShell.Header>

				<AppShell.Navbar p="md" bg="gray.1">
					<Stack gap="xs" h="100%">
						{navItems.map((item) => (
							<RequireRole
								projectId={projectId as string}
								key={item.label}
								requiredRole={item.requiredRole}
							>
								<NavLink
									label={item.label}
									leftSection={item.icon}
									active={
										path === item.href ||
										(item.href.includes("/ai") && path.includes("/ai"))
									}
									onClick={() => router.push(item.href)}
									color="violet"
									variant="filled"
									style={{
										borderRadius: 4,
										fontWeight:
											path === item.href ||
											(item.href.includes("/ai") && path.includes("/ai"))
												? 600
												: 400,
									}}
								/>
							</RequireRole>
						))}

						<div style={{ marginTop: "auto" }}>
							<Button
								fullWidth
								variant="subtle"
								color="dark"
								leftSection={<TbArrowLeft size={20} />}
								onClick={() => router.push(APP_ROUTES.HOME)}
							>
								Back to Projects
							</Button>
						</div>
					</Stack>
				</AppShell.Navbar>

				<AppShell.Main h="100vh" bg="white">
					{children}
				</AppShell.Main>
			</AuthProvider>
		</AppShell>
	);
};

export default NewProjectLayout;
