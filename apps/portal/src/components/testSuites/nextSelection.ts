/**
 * Which suite to open once `deletedId` is gone: the one that slid into its
 * place, else the one before it, else nothing. `list` is the pre-delete list.
 * Deleting a suite other than the open one leaves the selection alone.
 */
export function selectionAfterDelete(
	list: { id: string }[],
	deletedId: string,
	selectedId: string | null,
): string | null {
	if (deletedId !== selectedId) return selectedId;
	const remaining = list.filter((suite) => suite.id !== deletedId);
	const index = list.findIndex((suite) => suite.id === deletedId);
	return (remaining[index] ?? remaining[index - 1])?.id ?? null;
}
