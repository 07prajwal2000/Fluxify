"use client";
import React, { useEffect, useState } from "react";
import { Container, Stack, Tabs } from "@mantine/core";
import Header from "@/components/homepage/Header";
import ProjectsTab from "@/components/homepage/ProjectsTab";
import UsersList from "@/components/settings/usersList";
import InstanceSettingsTab from "@/components/homepage/InstanceSettingsTab";
import AccountDetails from "@/components/settings/accountDetails";
import { useAuthStore } from "@/store/auth";
import { useRouter, useSearchParams } from "next/navigation";

const NewHomepage = () => {
	const { userData } = useAuthStore();
	const searchParams = useSearchParams();
	const router = useRouter();
	const [activeTab, setActiveTab] = useState<string | null>("projects");

	useEffect(() => {
		const tab = searchParams.get("tab");
		if (tab) {
			setActiveTab(tab);
		}
	}, [searchParams]);

	const handleTabChange = (value: string | null) => {
		setActiveTab(value);
		if (value) {
			router.push(`?tab=${value}`);
		}
	};

	return (
		<Stack style={{ height: "100vh", backgroundColor: "#f9f9f9" }} gap={0}>
			<Header />

			<Container
				size="xl"
				w="100%"
				style={{ flex: 1, overflowY: "auto", position: "relative" }}
			>
				<Tabs
					value={activeTab}
					onChange={handleTabChange}
					color="violet"
					variant="outline"
				>
					<Tabs.List 
						style={{ 
							position: "sticky", 
							top: 0, 
							zIndex: 10, 
							backgroundColor: "#f9f9f9",
							paddingTop: "24px"
						}}
					>
						<Tabs.Tab value="projects">Projects</Tabs.Tab>
						{userData?.isSystemAdmin && (
							<>
								<Tabs.Tab value="users">Users</Tabs.Tab>
								<Tabs.Tab value="instance-settings">Instance Settings</Tabs.Tab>
							</>
						)}
						<Tabs.Tab value="account-details">Account details</Tabs.Tab>
					</Tabs.List>

					<Tabs.Panel value="projects" pt="xl" pb="xl">
						<ProjectsTab />
					</Tabs.Panel>

					{userData?.isSystemAdmin && (
						<>
							<Tabs.Panel value="users" pt="xl" pb="xl">
								<UsersList />
							</Tabs.Panel>

							<Tabs.Panel value="instance-settings" pt="xl" pb="xl">
								<InstanceSettingsTab />
							</Tabs.Panel>
						</>
					)}

					<Tabs.Panel value="account-details" pt="xl" pb="xl">
						<AccountDetails />
					</Tabs.Panel>
				</Tabs>
			</Container>
		</Stack>
	);
};

export default NewHomepage;
