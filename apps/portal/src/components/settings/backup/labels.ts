import type { BackupMode, BackupSection } from "@/services/backups";

/** what each registered section is called; a section with no entry here shows its own name */
export const SECTION_LABELS: Record<string, { label: string; description: string }> = {
	appConfig: {
		label: "App config",
		description: "The setting names. Values only come with the option below.",
	},
	integrations: {
		label: "Integrations",
		description: "Connections to databases, queues and other services.",
	},
	projectSettings: {
		label: "Project settings",
		description: "Subdomain, AI agent, telemetry and limits.",
	},
	projectDependencies: { label: "npm packages", description: "The packages your code blocks use." },
	plugins: { label: "Plugins", description: "Installed plugins, with their files." },
	customBlocks: { label: "Custom blocks", description: "Your own blocks and their versions." },
	middlewares: {
		label: "Middlewares",
		description: "Block chains that run before or after routes.",
	},
	routes: { label: "Routes", description: "Canvas, schemas, tests and whether each is live." },
	workflows: { label: "Workflows", description: "Canvas, tests and whether each is live." },
	triggers: { label: "Triggers", description: "Schedules and queue triggers, with their groups." },
	knowledgeSources: { label: "Knowledge sources", description: "Documents the AI agent searches." },
};

export const labelOf = (name: string) => SECTION_LABELS[name]?.label ?? name;

export const MODE_COPY: Record<BackupMode, { title: string; body: string }> = {
	backup: {
		title: "Backup",
		body: "A full copy of this project, secrets included, encrypted with this instance's master key. It can only be restored on an instance that uses the same key.",
	},
	template: {
		title: "Template",
		body: "A copy to start new projects from. It leaves out secrets, plugin approval, uploaded knowledge documents and production switches, and it isn't encrypted.",
	},
};

/** what leaving a section out does to the ones that use it, said once per section */
const WITHOUT: Record<string, string> = {
	appConfig:
		"Integrations and knowledge sources can refer to app config keys; without them those come in empty.",
	integrations: "Routes use integrations; without them their connections come in empty.",
	plugins: "Without plugins, plugin blocks and plugin triggers are left off.",
	customBlocks:
		"A route, workflow or middleware that calls a custom block can't be restored without it.",
	middlewares: "A route that uses a middleware can't be restored without it.",
	workflows: "A trigger runs a workflow; one whose workflow isn't in the backup can't be restored.",
};

/**
 * One line under an unticked section when something ticked depends on it, so the
 * consequence is read before it happens. Nothing is blocked: the backup is made
 * either way. Null when nothing ticked needs it.
 */
export function dependencyHint(name: string, ticked: Set<string>, sections: BackupSection[]) {
	if (ticked.has(name)) return null;
	const used = sections.some((s) => ticked.has(s.name) && s.dependsOn.includes(name));
	if (!used) return null;
	return (
		WITHOUT[name] ??
		`Ticked resources use ${labelOf(name)}; without it their references come in empty.`
	);
}
