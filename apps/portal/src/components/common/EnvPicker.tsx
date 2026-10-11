import { Checkbox, Tooltip } from "@fluxify/components";
import { useState } from "react";
import { ConfirmDialog } from "./ConfirmDialog";

export type RunEnv = "development" | "production";

/**
 * Development / Production, as a toggle (#739). Development is the default and
 * the safe one; Production needs a promoted version and, where the caller asks
 * for it, is confirmed first. Built on the shared Checkbox, per the house rule
 * for toggles.
 */
export function EnvPicker({
	env,
	onEnvChange,
	productionDisabled,
	disabledReason = "Not promoted yet",
	confirm,
	confirmOnce,
	className,
}: {
	env: RunEnv;
	onEnvChange: (env: RunEnv) => void;
	/** production is not available: nothing has been promoted */
	productionDisabled?: boolean;
	/** why production is unavailable */
	disabledReason?: string;
	/** asked before switching to production; every time unless `confirmOnce` */
	confirm?: string;
	/** ask only the first time in this mount (the playground); otherwise every switch */
	confirmOnce?: boolean;
	className?: string;
}) {
	const [pending, setPending] = useState(false);
	const [confirmed, setConfirmed] = useState(false);

	function pick(selected: boolean) {
		if (!selected) {
			onEnvChange("development");
			return;
		}
		if (confirm && !(confirmOnce && confirmed)) {
			setPending(true);
			return;
		}
		onEnvChange("production");
	}

	return (
		<>
			{/* the long explanation lives in a tooltip, so the header stays one line */}
			<Tooltip>
				<span className="inline-flex items-center">
					<Checkbox
						className={className}
						isSelected={env === "production"}
						isDisabled={productionDisabled}
						onChange={pick}
						label="Run in Production"
						// a disabled box takes no hover, so its reason stays visible
						description={productionDisabled ? disabledReason : undefined}
					/>
				</span>
				<Tooltip.Content>
					{env === "production"
						? "Calls the promoted version with development credentials."
						: "Runs the saved working copy on the development worker."}
				</Tooltip.Content>
			</Tooltip>
			{confirm && (
				<ConfirmDialog
					open={pending}
					onOpenChange={(open) => !open && setPending(false)}
					title="Run against production?"
					confirmText="Continue"
					onConfirm={() => {
						if (confirmOnce) setConfirmed(true);
						setPending(false);
						onEnvChange("production");
					}}
				>
					{confirm}
				</ConfirmDialog>
			)}
		</>
	);
}
