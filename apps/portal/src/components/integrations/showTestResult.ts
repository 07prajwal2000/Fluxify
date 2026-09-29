import { toast } from "@fluxify/components";

/** a connection can succeed with a warning: a MongoDB server with no replica set cannot run transactions */
export function showTestResult(res?: { success: boolean; error?: string; warning?: string }) {
	if (!res?.success) toast.danger(res?.error || "Connection failed");
	else if (res.warning) toast.warning(`Connected, but: ${res.warning}`);
	else toast.success("Connection successful");
}
