import { BadRequestError } from "@fluxify/server";

export interface MessageCursor {
	createdAt: Date;
	id: string;
}

/** `createdAt` alone isn't unique, so the id is carried along as a tiebreaker —
 *  both halves are needed for the row-wise `<` comparison in the repository. */
export function encodeCursor(cursor: MessageCursor): string {
	return Buffer.from(
		`${cursor.createdAt.toISOString()}|${cursor.id}`,
	).toString("base64url");
}

export function decodeCursor(raw: string): MessageCursor {
	const [createdAt, id] = Buffer.from(raw, "base64url")
		.toString()
		.split("|");
	const date = new Date(createdAt ?? "");
	if (!id || Number.isNaN(date.getTime())) {
		throw new BadRequestError("Invalid cursor");
	}
	return { createdAt: date, id };
}
