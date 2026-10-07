import { z } from "zod";
import { requestParamSchema as runsParamSchema } from "../delete-runs/dto";

export { responseSchema } from "../delete-runs/dto";

export const requestParamSchema = runsParamSchema.extend({
	runId: z.uuid(),
});
