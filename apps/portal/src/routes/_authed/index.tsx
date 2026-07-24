import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { Tabs } from "@fluxify/components";
import { ProfileNav } from "@/components/home/ProfileNav";
import { ProjectsTab } from "@/components/home/ProjectsTab";
import { UsersList } from "@/components/home/UsersList";
import { AccountDetails } from "@/components/home/AccountDetails";
import { InstanceSettings } from "@/components/home/InstanceSettings";
import { useAuthStore } from "@/store/auth";

const logo = `${import.meta.env.BASE_URL}logo_title.webp`;

export const Route = createFileRoute("/_authed/")({
	validateSearch: z.object({ tab: z.string().optional() }),
	component: Home,
});

function Home() {
	const { tab } = Route.useSearch();
	const navigate = useNavigate();
	const { userData } = useAuthStore();
	const selected = tab ?? "projects";

	return (
		<div className="flex min-h-screen flex-col bg-background text-foreground">
			<header className="flex items-center justify-between border-b border-border px-6 py-3">
				<div className="w-10" />
				<img src={logo} alt="Fluxify" className="h-8 object-contain" />
				<ProfileNav />
			</header>

			<main className="mx-auto w-full max-w-screen-xl flex-1 px-6 py-6">
				<Tabs
					selectedKey={selected}
					onSelectionChange={(key) =>
						navigate({ to: "/", search: { tab: String(key) } })
					}
				>
					<Tabs.List>
						<Tabs.Tab id="projects">Projects</Tabs.Tab>
						{userData?.isSystemAdmin && (
							<Tabs.Tab id="users">Users</Tabs.Tab>
						)}
						{userData?.isSystemAdmin && (
							<Tabs.Tab id="instance">Instance Settings</Tabs.Tab>
						)}
						<Tabs.Tab id="account">Account</Tabs.Tab>
					</Tabs.List>

					<Tabs.Panel id="projects">
						<ProjectsTab />
					</Tabs.Panel>
					{userData?.isSystemAdmin && (
						<Tabs.Panel id="users">
							<UsersList />
						</Tabs.Panel>
					)}
					{userData?.isSystemAdmin && (
						<Tabs.Panel id="instance">
							<InstanceSettings />
						</Tabs.Panel>
					)}
					<Tabs.Panel id="account">
						<AccountDetails />
					</Tabs.Panel>
				</Tabs>
			</main>
		</div>
	);
}
