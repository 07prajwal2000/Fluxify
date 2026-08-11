import { cn } from "@fluxify/components";
import { Link } from "@tanstack/react-router";
import { FiShield } from "react-icons/fi";

interface SidebarProps {
	activeTab: string;
}

const SETTINGS_CATEGORIES = [
	{ id: "auth", label: "Authentication", icon: FiShield },
	// Placeholders for future:
	// { id: "general", label: "General", icon: Settings },
];

export function Sidebar({ activeTab }: SidebarProps) {
	return (
		<nav className="flex flex-col gap-1">
			{SETTINGS_CATEGORIES.map((category) => {
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
