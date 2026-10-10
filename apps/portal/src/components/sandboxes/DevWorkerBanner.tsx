import { Alert } from "@fluxify/components";
import { DEV_WORKER_MESSAGE } from "./sandboxRequest";

/** Under the sandbox header while nothing is running to serve it. */
export function DevWorkerBanner({ online }: { online: boolean }) {
	if (online) return null;
	return (
		<Alert status="warning" className="rounded-none">
			<Alert.Content>
				<Alert.Description>{DEV_WORKER_MESSAGE}</Alert.Description>
			</Alert.Content>
		</Alert>
	);
}
