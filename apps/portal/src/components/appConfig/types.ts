export type ConfigRow = {
	id: number;
	keyName: string;
	isEncrypted: boolean;
	encodingType: "plaintext" | "base64" | "hex";
	dataType: "string" | "number" | "boolean";
	createdAt: string;
	updatedAt: string;
};

export type SortBy = "id" | "keyName" | "createdAt" | "updatedAt" | "isEncrypted" | "encodingType";
