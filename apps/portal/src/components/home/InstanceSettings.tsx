import { Sidebar } from "./instance-settings/Sidebar";
import { AuthSettings } from "./instance-settings/auth/AuthSettings";

interface InstanceSettingsProps {
	activeTab?: string;
}

export function InstanceSettings({ activeTab = "auth" }: InstanceSettingsProps) {
	return (
		<div className="flex flex-row gap-8 pt-4">
			<aside className="w-64 flex-shrink-0 sticky top-24 self-start">
				<Sidebar activeTab={activeTab} />
			</aside>
			<main className="flex-1 overflow-y-auto min-h-[500px]">
				{activeTab === "auth" && <AuthSettings />}
				{/*
					Placeholder for future tabs:
					{activeTab === "general" && <GeneralSettings />}
				*/}
			</main>
		</div>
	);
}
