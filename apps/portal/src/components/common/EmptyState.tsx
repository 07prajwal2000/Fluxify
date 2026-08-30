/** The dashed placeholder a list screen shows when it has nothing to list. */
export function EmptyState({
	icon,
	title,
	description,
	action,
}: {
	icon: React.ReactNode;
	title: string;
	description: string;
	action?: React.ReactNode;
}) {
	return (
		<div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-16 text-center">
			<span className="text-muted">{icon}</span>
			<p className="text-sm font-medium text-foreground">{title}</p>
			<p className="max-w-sm text-xs text-muted">{description}</p>
			{action && <div className="mt-2">{action}</div>}
		</div>
	);
}
