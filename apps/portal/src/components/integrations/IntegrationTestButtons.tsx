import { Button } from "@fluxify/components";
import { TbBolt } from "react-icons/tb";
import { showTestResult } from "@/components/integrations/showTestResult";
import { showErrorNotification } from "@/lib/errorNotifier";
import { integrationsQuery } from "@/query/integrationsQuery";
import { useCanEditProject } from "@/store/auth";

export function IntegrationTestButtons({
	projectId,
	integrationId,
}: {
	projectId: string;
	integrationId: string;
}) {
	const canEdit = useCanEditProject(projectId);
	const test = integrationsQuery.testExistingConnection.mutation(projectId);
	const testProd = integrationsQuery.testProductionConnection.mutation(projectId);

	return (
		<div className="flex items-center gap-2">
			<Button
				variant="outline"
				size="sm"
				isPending={test.isPending && test.variables === integrationId}
				onPress={() =>
					test.mutate(integrationId, {
						onSuccess: showTestResult,
						onError: (e) => showErrorNotification(e as Error),
					})
				}
				className="whitespace-nowrap"
			>
				<TbBolt size={14} className="text-accent" />
				<span>Test connection</span>
			</Button>
			{canEdit && (
				<Button
					variant="outline"
					size="sm"
					isPending={testProd.isPending && testProd.variables === integrationId}
					onPress={() =>
						testProd.mutate(integrationId, {
							onSuccess: showTestResult,
							onError: (e) => showErrorNotification(e as Error),
						})
					}
					className="whitespace-nowrap"
				>
					<TbBolt size={14} className="text-accent" />
					<span>Test production credentials</span>
				</Button>
			)}
		</div>
	);
}
