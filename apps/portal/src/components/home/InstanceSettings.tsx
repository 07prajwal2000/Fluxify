import { FiAward, FiGlobe, FiShield } from "react-icons/fi";
import { TbTopologyStar3 } from "react-icons/tb";
import { publicSettingsQuery } from "@/query/publicSettingsQuery";
import { AuthSettings } from "./instance-settings/auth/AuthSettings";
import { HostingSettings } from "./instance-settings/hosting/HostingSettings";
import { LicenseSettings } from "./instance-settings/license/LicenseSettings";
import { OrchestrationSettings } from "./instance-settings/orchestration/OrchestrationSettings";
import { SettingsLayout } from "./SettingsLayout";

interface InstanceSettingsProps {
	activeTab?: string;
}

export function InstanceSettings({ activeTab = "auth" }: InstanceSettingsProps) {
	const { data: publicSettings } = publicSettingsQuery.get.useQuery();
	// Orchestration only shows on a deployment that has an orchestrator. Kit has
	// none, and a tab whose endpoints answer 404 is worse than no tab.
	const showOrchestration = publicSettings?.orchestration?.enabled !== false;
	const sections = [
		{ id: "auth", label: "Authentication", icon: FiShield },
		{ id: "license", label: "License", icon: FiAward },
		{ id: "hosting", label: "Hosting", icon: FiGlobe },
		...(showOrchestration
			? [{ id: "orchestration", label: "Orchestration", icon: TbTopologyStar3 }]
			: []),
	];

	return (
		<SettingsLayout
			title="Instance settings"
			description="Manage your instance configurations, authentication, license, hosting, and orchestration."
			sidebarLabel="Instance"
			sections={sections}
			activeId={activeTab}
			searchFor={(id) => ({ tab: "instance", settingsTab: id })}
		>
			{activeTab === "auth" && <AuthSettings />}
			{activeTab === "license" && <LicenseSettings />}
			{activeTab === "orchestration" && <OrchestrationSettings />}
			{activeTab === "hosting" && <HostingSettings />}
		</SettingsLayout>
	);
}
