import { cn } from "@fluxify/components";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { IconType } from "react-icons";

export interface SettingsSection {
	id: string;
	label: string;
	icon: IconType;
}

interface SettingsLayoutProps {
	title: string;
	description: string;
	/** Small heading above the section list. */
	sidebarLabel: string;
	sections: SettingsSection[];
	activeId: string;
	/** Search params that select a section, so a link or refresh opens it. */
	searchFor: (id: string) => { tab: string; settingsTab?: string; accountTab?: string };
	children: ReactNode;
}

/** Sidebar of sections + the chosen section's panel. Shared by instance settings and account. */
export function SettingsLayout({
	title,
	description,
	sidebarLabel,
	sections,
	activeId,
	searchFor,
	children,
}: SettingsLayoutProps) {
	return (
		<div className="flex h-[calc(100vh-7rem)] w-full flex-col">
			<div className="mb-4 shrink-0">
				<h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
				<p className="text-sm text-muted">{description}</p>
			</div>

			<div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-surface md:flex-row">
				<nav
					aria-label={sidebarLabel}
					className="flex shrink-0 gap-1 overflow-x-auto border-b border-border p-2 md:w-[240px] md:flex-col md:overflow-y-auto md:border-r md:border-b-0 md:py-6 md:pl-4 md:pr-3"
				>
					<div className="mb-2 hidden px-3 text-xs font-semibold tracking-wider text-muted uppercase md:block">
						{sidebarLabel}
					</div>
					{sections.map((section) => {
						const Icon = section.icon;
						const isActive = activeId === section.id;

						return (
							<Link
								key={section.id}
								to="/"
								search={searchFor(section.id)}
								aria-current={isActive ? "page" : undefined}
								className={cn(
									"flex shrink-0 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
									isActive
										? "bg-surface-secondary text-foreground"
										: "text-muted hover:bg-surface-secondary hover:text-foreground",
								)}
							>
								<Icon size={18} className={isActive ? "text-foreground" : "text-muted"} />
								{section.label}
							</Link>
						);
					})}
				</nav>
				<div className="flex-1 overflow-y-auto p-4 md:p-8">
					<div className="max-w-4xl">{children}</div>
				</div>
			</div>
		</div>
	);
}
