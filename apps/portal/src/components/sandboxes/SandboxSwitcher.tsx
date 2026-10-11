import { useNavigate } from "@tanstack/react-router";
import { EntitySwitcher } from "@/components/common/EntitySwitcher";
import { sandboxesQuery } from "@/query/sandboxesQuery";

/** Canvas header nav: back to the sandboxes list, stepper, and switcher over the user's sandboxes. */
export function SandboxSwitcher({
	projectId,
	sandboxId,
}: {
	projectId: string;
	sandboxId: string;
}) {
	const navigate = useNavigate();
	const { data, isLoading } = sandboxesQuery.getAll.useQuery(projectId);
	const byId = sandboxesQuery.byId.useQuery(projectId, sandboxId);
	const listed = data ?? [];
	// The open sandbox can sit past the list or be newly created; keep it selectable either way.
	const sandboxes =
		listed.some((s) => s.id === sandboxId) || !byId.data ? listed : [byId.data, ...listed];

	return (
		<EntitySwitcher
			backLabel="Sandboxes"
			noun="sandbox"
			currentId={sandboxId}
			isLoading={isLoading}
			onBack={() => navigate({ to: "/$projectId/sandboxes", params: { projectId } })}
			onSelect={(id) =>
				navigate({
					to: "/$projectId/sandbox-canvas/$sandboxId",
					params: { projectId, sandboxId: id },
				})
			}
			items={sandboxes.map((s) => ({
				id: s.id,
				textValue: s.name ?? s.id,
				label: (
					<span className="flex min-w-0 items-center gap-2">
						<span className="truncate text-xs">{s.name || "Untitled"}</span>
					</span>
				),
			}))}
		/>
	);
}
