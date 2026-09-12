import { cn } from "@fluxify/components";
import { Link } from "@tanstack/react-router";
import { FiAward, FiShield } from "react-icons/fi";
import { TbTopologyStar3 } from "react-icons/tb";
import { publicSettingsQuery } from "@/query/publicSettingsQuery";

interface SidebarProps {
	activeTab: string;
}

const SETTINGS_CATEGORIES: {
	id: string;
	label: string;
	icon: typeof FiShield;
	/** Hidden unless the deployment reports this capability. */
	flag?: "orchestration";
}[] = [
	{ id: "auth", label: "Authentication", icon: FiShield },
	{ id: "license", label: "License", icon: FiAward },
	// Only on a deployment that has an orchestrator — see `orchestration` in
	// public settings. Kit has none, and a tab whose endpoints answer 404 is
	// worse than no tab.
	{ id: "orchestration", label: "Orchestration", icon: TbTopologyStar3, flag: "orchestration" },
	// Placeholders for future:
	// { id: "general", label: "General", icon: Settings },
];

export function Sidebar({ activeTab }: SidebarProps) {
	const { data: publicSettings } = publicSettingsQuery.get.useQuery();
	const categories = SETTINGS_CATEGORIES.filter(
		(category) =>
			category.flag !== "orchestration" || publicSettings?.orchestration?.enabled !== false,
	);

	return (
		<nav className="flex flex-col gap-1">
			{categories.map((category) => {
				const Icon = category.icon;
				const isActive = activeTab === category.id;

				return (
					<Link
						key={category.id}
						to="/"
						search={{ tab: "instance", settingsTab: category.id }}
						className={cn(
							"flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
							isActive
								? "bg-accent text-accent-foreground"
								: "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
						)}
					>
						<Icon className="h-4 w-4" />
						{category.label}
					</Link>
				);
			})}
		</nav>
	);
}
