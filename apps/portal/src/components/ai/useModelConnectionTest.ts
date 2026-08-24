import { useEffect, useState } from "react";
import { toast } from "@fluxify/components";
import { integrationsQuery } from "@/query/integrationsQuery";

export type ConnectionStatus = "testing" | "success" | "error" | "idle";

/** Verifies the selected model and exposes its send-ready state. */
export function useModelConnectionTest(projectId: string, model: string): ConnectionStatus {
	const testConn = integrationsQuery.testExistingConnection.mutation(projectId);
	const [status, setStatus] = useState<ConnectionStatus>("idle");

	useEffect(() => {
		if (!model) return;
		let isCurrent = true;
		setStatus("testing");
		const connectionTest = testConn.mutateAsync(model).then((res) => {
			if (!res.success) throw new Error("Model connection failed");
			return res;
		});

		toast.promise(connectionTest, {
			loading: "Testing model connection…",
			success: "Model connection ready",
			error: (error) => error.message || "Model connection failed",
		});

		connectionTest.then(
			() => {
				if (isCurrent) setStatus("success");
			},
			() => {
				if (isCurrent) setStatus("error");
			},
		);

		return () => {
			isCurrent = false;
		};
	// The mutation hook is stable for a project; only a project or model change
	// should start another verification.
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [model, projectId]);

	return status;
}
