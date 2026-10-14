import { Chip } from "@fluxify/components";

/** The environment a tool call ran in: the small Dev / Prod chip a card shows (#780). */
export function EnvChip({ env }: { env: string }) {
	const production = env === "production";
	return (
		<Chip
			size="sm"
			color={production ? "default" : "accent"}
			title={production ? "Production" : "Development"}
		>
			{production ? "Prod" : "Dev"}
		</Chip>
	);
}
