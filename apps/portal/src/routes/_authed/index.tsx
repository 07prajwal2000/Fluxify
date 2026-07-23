import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { Tabs } from "@fluxify/components";
import { ProfileNav } from "@/components/home/ProfileNav";
import { ProjectsTab } from "@/components/home/ProjectsTab";
import { useAuthStore } from "@/store/auth";

const logo = `${import.meta.env.BASE_URL}logo_title.webp`;

export const Route = createFileRoute("/_authed/")({
	validateSearch: z.object({ tab: z.string().optional() }),
	component: Home,
});

// ponytail: Users / Instance Settings / Account tabs are stubbed — next slice.
function Stub({ label }: { label: string }) {
	return <p className="py-16 text-center text-muted">{label} — coming soon.</p>;
}

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
					<Tabs.Panel id="users">
						<Stub label="Users" />
					</Tabs.Panel>
					<Tabs.Panel id="instance">
						<Stub label="Instance Settings" />
					</Tabs.Panel>
					<Tabs.Panel id="account">
						<Stub label="Account details" />
					</Tabs.Panel>
				</Tabs>
			</main>
		</div>
	);
}
