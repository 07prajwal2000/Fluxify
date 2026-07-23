export function ComingSoon({ title }: { title: string }) {
	return (
		<div className="flex flex-col gap-2">
			<h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
			<p className="text-muted">This section is being migrated.</p>
		</div>
	);
}
