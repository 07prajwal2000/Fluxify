import { Button, Spinner } from "@fluxify/components";
import { TbBolt } from "react-icons/tb";
import { EmptyState } from "@/components/common/EmptyState";
import { triggersQuery } from "@/query/triggersQuery";
import { TriggerWizard } from "./TriggerWizard";

/**
 * A saved trigger on its own page (#932), so it can be linked, bookmarked and
 * refreshed. Leaving, saving or a missing trigger all go back through `onDone`.
 */
export function TriggerPage({
	projectId,
	triggerId,
	onDone,
}: {
	projectId: string;
	triggerId: string;
	onDone: () => void;
}) {
	const { data: trigger, isLoading } = triggersQuery.byId.useQuery(triggerId);

	if (isLoading) {
		return (
			<div className="flex justify-center py-16">
				<Spinner />
			</div>
		);
	}
	// another project's trigger in this project's URL is as good as missing
	if (!trigger || trigger.projectId !== projectId) {
		return (
			<EmptyState
				icon={<TbBolt size={28} />}
				title="Trigger not found"
				description="It may have been deleted, or it belongs to another project."
				action={
					<Button variant="primary" onPress={onDone}>
						Back to triggers
					</Button>
				}
			/>
		);
	}
	return (
		// the page's height (main pads 1.5rem each side), so only the step scrolls
		<div className="h-[calc(100vh-3rem)]">
			<TriggerWizard
				key={trigger.id}
				projectId={projectId}
				initialTrigger={trigger}
				onBack={onDone}
				onSuccess={onDone}
				fill
			/>
		</div>
	);
}
