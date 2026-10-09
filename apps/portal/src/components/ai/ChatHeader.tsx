/** The chat's name, small and out of the way; a long one is cut with the full name on hover. */
export function ChatHeader({ title }: { title: string | null | undefined }) {
	const name = title || "Untitled session";
	return (
		<h1
			title={name}
			className="shrink-0 truncate border-b border-border px-4 py-1.5 text-center text-xs font-medium text-muted"
		>
			{name}
		</h1>
	);
}
