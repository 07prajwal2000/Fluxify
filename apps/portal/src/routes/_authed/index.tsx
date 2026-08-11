import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { ProfileNav } from "@/components/home/ProfileNav";
import { ProjectsTab } from "@/components/home/ProjectsTab";
import { UsersList } from "@/components/home/UsersList";
import { AccountDetails } from "@/components/home/AccountDetails";
import { InstanceSettings } from "@/components/home/InstanceSettings";
import { useAuthStore } from "@/store/auth";

const logo = `${import.meta.env.BASE_URL}icons/logo.svg`;

export const Route = createFileRoute("/_authed/")({
	validateSearch: z.object({
		tab: z.string().optional(),
		settingsTab: z.string().optional(),
	}),
	component: Home,
});

function Home() {
	const { tab, settingsTab } = Route.useSearch();
	const navigate = useNavigate();
	const { userData } = useAuthStore();
	const selected = tab ?? "projects";

	return (
		<div className="flex min-h-screen flex-col bg-background text-foreground">
			<header className="sticky top-0 z-50 flex h-16 items-center border-b border-border bg-background px-6">
				<div className="z-10 flex items-center gap-2">
					<img src={logo} alt="Fluxify" className="h-16 w-16 object-contain" />
					<span className="text-lg font-bold tracking-wide">FLUXIFY</span>
				</div>

				<nav aria-label="Home navigation" className="relative z-10 ml-6 flex h-full items-stretch">
					<button
						type="button"
						onClick={() => navigate({ to: "/", search: { tab: "projects" } })}
						aria-current={selected === "projects" ? "page" : undefined}
						className={`relative flex h-full cursor-pointer items-center px-5 text-base transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset ${
							selected === "projects"
								? "text-foreground after:absolute after:inset-x-3 after:-bottom-px after:h-[3px] after:bg-accent"
								: "text-muted-foreground hover:bg-surface-secondary/60 hover:text-foreground"
						}`}
					>
						Projects
					</button>
					{userData?.isSystemAdmin && (
						<button
							type="button"
							onClick={() => navigate({ to: "/", search: { tab: "users" } })}
							aria-current={selected === "users" ? "page" : undefined}
							className={`relative flex h-full cursor-pointer items-center px-5 text-base transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset ${
								selected === "users"
									? "text-foreground after:absolute after:inset-x-3 after:-bottom-px after:h-[3px] after:bg-accent"
									: "text-muted-foreground hover:bg-surface-secondary/60 hover:text-foreground"
							}`}
						>
							Users
						</button>
					)}
					{userData?.isSystemAdmin && (
						<button
							type="button"
							onClick={() => navigate({ to: "/", search: { tab: "instance" } })}
							aria-current={selected === "instance" ? "page" : undefined}
							className={`relative flex h-full cursor-pointer items-center px-5 text-base transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset ${
								selected === "instance"
									? "text-foreground after:absolute after:inset-x-3 after:-bottom-px after:h-[3px] after:bg-accent"
									: "text-muted-foreground hover:bg-surface-secondary/60 hover:text-foreground"
							}`}
						>
							Instance Settings
						</button>
					)}
					<button
						type="button"
						onClick={() => navigate({ to: "/", search: { tab: "account" } })}
						aria-current={selected === "account" ? "page" : undefined}
						className={`relative flex h-full cursor-pointer items-center px-5 text-base transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset ${
							selected === "account"
								? "text-foreground after:absolute after:inset-x-3 after:-bottom-px after:h-[3px] after:bg-accent"
								: "text-muted-foreground hover:bg-surface-secondary/60 hover:text-foreground"
						}`}
					>
						Account
					</button>
				</nav>

				<div className="ml-auto flex w-64 justify-end py-3">
					<ProfileNav />
				</div>
			</header>

			<main className="mx-auto w-full max-w-screen-xl flex-1 px-6 py-6">
				{selected === "projects" && <ProjectsTab />}
				{selected === "users" && userData?.isSystemAdmin && <UsersList />}
				{selected === "instance" && userData?.isSystemAdmin && (
					<InstanceSettings activeTab={settingsTab ?? "auth"} />
				)}
				{selected === "account" && <AccountDetails />}
			</main>
		</div>
	);
}
