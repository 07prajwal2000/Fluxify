import type { ReactNode } from "react";
import { FaRobot, FaTableList } from "react-icons/fa6";
import { TbArrowsExchange, TbCloudCog, TbDatabase, TbHeartRateMonitor } from "react-icons/tb";
import { VscMcp } from "react-icons/vsc";

export const GROUP_DETAILS: Record<string, { description: string; icon: ReactNode }> = {
	database: { description: "Connect a production database", icon: <TbDatabase size={20} /> },
	kv: { description: "Connect a cache or key-value store", icon: <FaTableList size={18} /> },
	ai: { description: "Connect an AI provider or compatible endpoint", icon: <FaRobot size={18} /> },
	baas: { description: "Connect a managed backend service", icon: <TbCloudCog size={20} /> },
	observability: {
		description: "Send logs and telemetry to your stack",
		icon: <TbHeartRateMonitor size={20} />,
	},
	queue: {
		description: "Start workflows from a message queue",
		icon: <TbArrowsExchange size={20} />,
	},
	mcp: {
		description: "Connect an external MCP server",
		icon: <VscMcp size={20} />,
	},
};
