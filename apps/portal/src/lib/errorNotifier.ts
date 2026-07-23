import { toast } from "@fluxify/components";
import { isAxiosError } from "axios";

// Same behavior as the web app's notifier, ported to HeroUI toasts.
export function showErrorNotification(error?: Error, showValidationErrors = true) {
	if (isAxiosError(error)) {
		const data = error.response?.data;
		if (error.response?.status === 400 && data?.type === "validation") {
			if (!showValidationErrors) {
				toast.danger("Validation Error. Please provide valid data.");
				return;
			}
			for (const err of data.errors) {
				toast.danger(`${err.message} (field: ${err.field})`);
			}
			return;
		}
		toast.danger(data?.message || "Unknown error occured");
		return;
	}
	toast.danger(error?.message || "Unknown error occured");
}
