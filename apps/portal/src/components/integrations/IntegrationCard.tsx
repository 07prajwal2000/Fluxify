import { Chip } from "@fluxify/components";
import { Link } from "@tanstack/react-router";
import { IntegrationTestButtons } from "./IntegrationTestButtons";
import { IntegrationVariantIcon } from "./IntegrationVariantIcon";

type Props = {
	projectId: string;
	integration: { id: string; name: string; group: string; variant: string; syncDev?: boolean };
	/** the category's display name, shown after the variant */
	groupLabel: string;
	icon?: string;
	/** false when the variant is no longer offered (its plugin is disabled) */
	variantKnown: boolean;
};

/** One configured integration as a full-width row. The whole row opens it; the test buttons sit above that link. */
export function IntegrationCard({ projectId, integration, groupLabel, icon, variantKnown }: Props) {
	return (
		<div className="relative flex items-center gap-4 rounded-xl border border-border bg-surface px-4 py-3 transition-colors focus-within:border-accent hover:border-accent/60 hover:bg-surface-secondary/40">
			<div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-secondary text-accent">
				<IntegrationVariantIcon
					variant={integration.variant}
					group={integration.group}
					icon={icon}
					size={20}
				/>
			</div>
			<div className="min-w-0 flex-1">
				<div className="flex min-w-0 items-center gap-2">
					<Link
						to="/$projectId/integrations/$integrationId"
						params={{ projectId, integrationId: integration.id }}
						className="truncate font-medium text-foreground outline-none after:absolute after:inset-0 after:content-['']"
					>
						{integration.name}
					</Link>
					{!variantKnown && (
						<Chip size="sm" color="warning">
							plugin disabled
						</Chip>
					)}
				</div>
				<p className="truncate text-xs text-muted">
					{integration.variant} • {groupLabel}
				</p>
			</div>
			<div className="relative shrink-0">
				<IntegrationTestButtons
					projectId={projectId}
					integrationId={integration.id}
					syncDev={integration.syncDev}
				/>
			</div>
		</div>
	);
}
