import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { Tabs } from "@fluxify/components";
import { ProfileNav } from "@/components/home/ProfileNav";
import { ProjectsTab } from "@/components/home/ProjectsTab";
import { UsersList } from "@/components/home/UsersList";
import { AccountDetails } from "@/components/home/AccountDetails";
import { InstanceSettings } from "@/components/home/InstanceSettings";
import { useAuthStore } from "@/store/auth";

const logo = `${import.meta.env.BASE_URL}icons/logo.svg`;

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
			<header className="sticky top-0 z-50 bg-background flex items-center justify-between px-6 border-b border-border">
				<div className="flex w-64 items-center gap-2">
					<img src={logo} alt="Fluxify" className="h-7 w-7 object-contain" />
					<span className="text-lg font-bold tracking-wide">FLUXIFY</span>
				</div>

				<div className="flex flex-1 justify-center pt-3">
					<Tabs
						selectedKey={selected}
						onSelectionChange={(key) =>
							navigate({ to: "/", search: { tab: String(key) } })
						}
						variant="secondary"
					>
						<Tabs.ListContainer>
							<Tabs.List>
								<Tabs.Tab id="projects" className="whitespace-nowrap !outline-none data-[focus-visible=true]:!ring-0 data-[focus-visible=true]:!ring-offset-0">
									Projects
									<Tabs.Indicator />
								</Tabs.Tab>
								{userData?.isSystemAdmin && (
									<Tabs.Tab id="users" className="whitespace-nowrap !outline-none data-[focus-visible=true]:!ring-0 data-[focus-visible=true]:!ring-offset-0">
										Users
										<Tabs.Indicator />
									</Tabs.Tab>
								)}
								{userData?.isSystemAdmin && (
									<Tabs.Tab id="instance" className="whitespace-nowrap !outline-none data-[focus-visible=true]:!ring-0 data-[focus-visible=true]:!ring-offset-0">
										Instance Settings
										<Tabs.Indicator />
									</Tabs.Tab>
								)}
								<Tabs.Tab id="account" className="whitespace-nowrap !outline-none data-[focus-visible=true]:!ring-0 data-[focus-visible=true]:!ring-offset-0">
									Account
									<Tabs.Indicator />
								</Tabs.Tab>
							</Tabs.List>
						</Tabs.ListContainer>
					</Tabs>
				</div>

				<div className="flex w-64 justify-end py-3">
					<ProfileNav />
				</div>
			</header>

			<main className="mx-auto w-full max-w-screen-xl flex-1 px-6 py-6">
				{selected === "projects" && <ProjectsTab />}
				{selected === "users" && userData?.isSystemAdmin && <UsersList />}
				{selected === "instance" && userData?.isSystemAdmin && <InstanceSettings />}
				{selected === "account" && <AccountDetails />}
			</main>
		</div>
	);
}
