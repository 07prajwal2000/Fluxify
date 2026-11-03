import type { FluxifyEnv } from "../../lib/env";

/** A trigger's two switches (#1072): `active` is production's, `devActive` development's. */
export type TriggerSwitches = { active: boolean; devActive: boolean };

/** Whether the trigger is switched on in one environment. */
export const triggerOn = (trigger: TriggerSwitches, env: FluxifyEnv) =>
	env === "development" ? trigger.devActive : trigger.active;

/** Switched on in at least one environment: it may consume somewhere. */
export const isOn = (trigger: TriggerSwitches) => trigger.active || trigger.devActive;
