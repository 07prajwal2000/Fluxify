import { PAGE_SIZE } from "./dto";
import { getMessagesPage } from "./repository";
import { decodeCursor, encodeCursor } from "./cursor";

/**
 * Reads newest-first (that's the direction pagination walks) but returns
 * oldest-first, so the agent UI can prepend a page straight into its message
 * list without reversing anything itself.
 *
 * Not cached: the newest page mutates while a run is in flight, and older
 * pages are cheap keyset seeks anyway.
 */
export default async function handleRequest(
	conversationId: string,
	rawCursor?: string,
) {
	const cursor = rawCursor ? decodeCursor(rawCursor) : undefined;

	// One extra row is the "is there more?" probe — cheaper than a count query.
	const rows = await getMessagesPage(conversationId, PAGE_SIZE + 1, cursor);
	const hasMore = rows.length > PAGE_SIZE;
	const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
	const oldest = page[page.length - 1];

	return {
		messages: page,
		pagination: {
			nextCursor: hasMore && oldest ? encodeCursor(oldest) : null,
			hasMore,
		},
	};
}
