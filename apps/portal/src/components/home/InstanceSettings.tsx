import { Sidebar } from "./instance-settings/Sidebar";
import { AuthSettings } from "./instance-settings/auth/AuthSettings";
import { LicenseSettings } from "./instance-settings/license/LicenseSettings";
import { OrchestrationSettings } from "./instance-settings/orchestration/OrchestrationSettings";

interface InstanceSettingsProps {
	activeTab?: string;
}

export function InstanceSettings({ activeTab = "auth" }: InstanceSettingsProps) {
	return (
		<div className="flex h-[calc(100vh-7rem)] w-full flex-col">
			<div className="mb-4 shrink-0">
				<h1 className="text-2xl font-semibold tracking-tight text-foreground">Instance settings</h1>
				<p className="text-sm text-muted">Manage your instance configurations, authentication, license, and orchestration.</p>
			</div>

			<div className="flex min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-surface">
				<Sidebar activeTab={activeTab} />
				<div className="flex-1 overflow-y-auto p-8">
					<div className="max-w-4xl">
						{activeTab === "auth" && <AuthSettings />}
						{activeTab === "license" && <LicenseSettings />}
						{activeTab === "orchestration" && <OrchestrationSettings />}
					</div>
				</div>
			</div>
		</div>
	);
}
