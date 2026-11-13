/** What `head` and `list` know about one object. */
export type StoredObject = {
	key: string;
	/** bytes */
	size: number;
	lastModified: Date;
};

/** One page of `list`. Pass `cursor` back to get the next; absent on the last page. */
export type StoredObjectPage = {
	objects: StoredObject[];
	cursor?: string;
};

export type PutObjectOptions = {
	/** stored as the object's Content-Type */
	contentType?: string;
};

export type ListObjectsOptions = {
	/** the `cursor` of the previous page */
	cursor?: string;
	/** most objects in one page; the provider's own cap (1000 on S3) when left out */
	limit?: number;
};

/**
 * Object storage adapter interface (the `storage` group). Keys are the
 * provider's own object keys, `/` included; there are no directories.
 */
export interface ObjectStorageAdapter {
	/** Writes the object, replacing one with the same key. Large bodies go up in parts. */
	put(
		key: string,
		body: Uint8Array | ReadableStream<Uint8Array>,
		options?: PutObjectOptions,
	): Promise<void>;
	/** the object's bytes as a stream, or null when there is no such key */
	get(key: string): Promise<ReadableStream<Uint8Array> | null>;
	/** the object's size and date, or null when there is no such key */
	head(key: string): Promise<StoredObject | null>;
	/** objects whose key starts with `prefix`, one page at a time, in key order */
	list(prefix: string, options?: ListObjectsOptions): Promise<StoredObjectPage>;
	/** Removes the object. A missing key is not an error. */
	delete(key: string): Promise<void>;
}

/** Inspect/metadata shape for object storage integrations. */
export type ObjectStorageInspectResult = unknown;
