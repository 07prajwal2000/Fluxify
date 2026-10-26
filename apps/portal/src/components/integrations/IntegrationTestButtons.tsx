import { showTestResult } from "@/components/integrations/showTestResult";
import { TestConnectionButton, useTestAbort } from "@/components/integrations/TestConnectionButton";
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
	const testAbort = useTestAbort();
	const prodAbort = useTestAbort();

	return (
		<div className="flex items-center gap-2">
			<TestConnectionButton
				isPending={test.isPending && test.variables?.id === integrationId}
				onPress={() =>
					test.mutate(
						{ id: integrationId, signal: testAbort.next() },
						{
							onSuccess: showTestResult,
							onError: (e) => showErrorNotification(e as Error),
						},
					)
				}
				onCancel={() => {
					testAbort.abort();
					test.reset();
				}}
			/>
			{canEdit && (
				<TestConnectionButton
					isPending={testProd.isPending && testProd.variables?.id === integrationId}
					onPress={() =>
						testProd.mutate(
							{ id: integrationId, signal: prodAbort.next() },
							{
								onSuccess: showTestResult,
								onError: (e) => showErrorNotification(e as Error),
							},
						)
					}
					onCancel={() => {
						prodAbort.abort();
						testProd.reset();
					}}
				>
					Test production credentials
				</TestConnectionButton>
			)}
		</div>
	);
}
