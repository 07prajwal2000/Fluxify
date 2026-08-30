/**
 * A titled block inside a settings panel. Every settings modal had its own copy
 * of this — same markup, same spacing — so there is one now.
 */
export function Section({
	title,
	description,
	children,
}: {
	title: string;
	description: string;
	children: React.ReactNode;
}) {
	return (
		<section className="mb-6 flex flex-col gap-4 last:mb-0">
			<div>
				<h3 className="text-sm font-semibold text-foreground">{title}</h3>
				<p className="mt-0.5 text-xs text-muted">{description}</p>
			</div>
			{children}
		</section>
	);
}
