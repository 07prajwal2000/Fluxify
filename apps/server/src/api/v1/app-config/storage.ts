import { EncryptionService } from "../../../lib/encryption";

type Encoding = "plaintext" | "base64" | "hex";

/** The stored form of a plain value: encrypted if asked to be, then encoded. */
export function storeValue(plain: string, isEncrypted: boolean, encodingType: Encoding) {
	return EncryptionService.encodeData(
		isEncrypted ? EncryptionService.encrypt(plain) : plain,
		encodingType,
	);
}

/** What the API may show of a stored value: nothing readable when it is encrypted. */
export function shownValue(stored: string | null, isEncrypted: boolean, encodingType: Encoding) {
	if (stored == null) return null;
	if (isEncrypted) return EncryptionService.maskValue(stored, "*").substring(0, 20);
	return EncryptionService.decodeData(stored, encodingType);
}

/**
 * The development value to write on update (#733): `undefined` leaves the
 * column alone, `null` clears it. A value the request did not touch is still
 * re-stored when the row's encryption or encoding changes, since both apply to
 * it exactly as they do to the production value.
 */
export function nextDevValue(
	current: { devValue: string | null; isEncrypted: boolean | null; encodingType: Encoding | null },
	body: {
		devValue?: string | number | boolean | null;
		isEncrypted: boolean;
		encodingType: Encoding;
	},
): string | null | undefined {
	if (body.devValue === null) return null;
	if (body.devValue !== undefined) {
		return storeValue(body.devValue.toString(), body.isEncrypted, body.encodingType);
	}
	if (current.devValue === null) return undefined;
	const encrypts = !current.isEncrypted && body.isEncrypted;
	if (!encrypts && current.encodingType === body.encodingType) return undefined;
	const decoded = EncryptionService.decodeData(current.devValue, current.encodingType!);
	// already ciphertext: only the encoding changes
	return current.isEncrypted
		? EncryptionService.encodeData(decoded, body.encodingType)
		: storeValue(decoded, body.isEncrypted, body.encodingType);
}
