/**
 * What the SSE runtime needs from a message broker. A plugin integration
 * variant can implement it later; the NATS and Redis ones live next to this file.
 *
 * Subjects are exact: there is no wildcard or pattern subscription, so a
 * message only ever reaches the connections that asked for that very subject.
 */
export interface SseBroker {
	publish(subject: string, message: string): Promise<void>;
	/** Resolves once the broker holds the subscription. The returned function undoes it, and is safe to call twice. */
	subscribe(subject: string, onMessage: (message: string) => void): Promise<() => Promise<void>>;
	/** Drops every subscription and every connection. The broker opens them again if used after. */
	close(): Promise<void>;
}

/** The subscriber connection of a transport: it owns the broker-side subscriptions. */
export type WireSubscriber = {
	add(subject: string): Promise<void>;
	remove(subject: string): Promise<void>;
	close(): Promise<void>;
};

/** One broker's protocol: publishing, and a subscriber connection that reports what it receives. */
export type Wire = {
	publish(subject: string, message: string): Promise<void>;
	connect(onMessage: (subject: string, message: string) => void): Promise<WireSubscriber>;
	/** closes the publishing side */
	close(): Promise<void>;
};

/**
 * A subject is dot-separated tokens. A `*` or `>` token is a NATS wildcard, so a
 * user-chosen id of `>` would turn one stream into a subscription to a whole
 * project; whitespace is not allowed in a NATS subject either.
 */
export function assertExactSubject(subject: string) {
	if (
		!subject ||
		/\s/.test(subject) ||
		subject.split(".").some((token) => !token || token === "*" || token === ">")
	)
		throw new Error(`"${subject}" is not an exact subject`);
}

/**
 * The part of a broker that is the same for every transport: it keeps ONE
 * subscriber connection, opened on the first subscription and closed when the
 * last one goes, and fans each message out to the listeners of its subject.
 */
export class SharedBroker implements SseBroker {
	private readonly listeners = new Map<string, Set<(message: string) => void>>();
	private subscriber?: Promise<WireSubscriber>;
	private turn: Promise<unknown> = Promise.resolve();

	constructor(private readonly wire: Wire) {}

	async publish(subject: string, message: string) {
		assertExactSubject(subject);
		await this.wire.publish(subject, message);
	}

	async subscribe(subject: string, onMessage: (message: string) => void) {
		assertExactSubject(subject);
		return this.exclusive(async () => {
			let set = this.listeners.get(subject);
			if (!set) {
				set = new Set();
				// listed before the broker confirms, so a first message cannot slip past
				this.listeners.set(subject, set);
				try {
					await (await this.open()).add(subject);
				} catch (error) {
					this.listeners.delete(subject);
					if (!this.listeners.size) await this.shut();
					throw error;
				}
			}
			set.add(onMessage);
			let undone = false;
			return () => {
				if (undone) return Promise.resolve();
				undone = true;
				return this.exclusive(() => this.drop(subject, onMessage));
			};
		});
	}

	close() {
		return this.exclusive(async () => {
			this.listeners.clear();
			await this.shut();
			await this.wire.close().catch(() => undefined);
		});
	}

	private open() {
		if (!this.subscriber) {
			const opening = this.wire.connect((subject, message) => this.deliver(subject, message));
			this.subscriber = opening;
			// a failed open is retried by the next subscribe, not cached
			opening.catch(() => {
				if (this.subscriber === opening) this.subscriber = undefined;
			});
		}
		return this.subscriber;
	}

	private deliver(subject: string, message: string) {
		for (const listener of [...(this.listeners.get(subject) ?? [])]) {
			try {
				listener(message);
			} catch {
				// one broken listener must not starve the others or kill the connection
			}
		}
	}

	private async drop(subject: string, onMessage: (message: string) => void) {
		const set = this.listeners.get(subject);
		if (!set?.delete(onMessage) || set.size) return;
		this.listeners.delete(subject);
		await (await this.subscriber)?.remove(subject).catch(() => undefined);
		if (!this.listeners.size) await this.shut();
	}

	private async shut() {
		const subscriber = this.subscriber;
		this.subscriber = undefined;
		await (await subscriber?.catch(() => undefined))?.close().catch(() => undefined);
	}

	/** subscribe, unsubscribe and close run one at a time, so the connection never opens and closes under each other */
	private exclusive<T>(run: () => Promise<T>): Promise<T> {
		const result = this.turn.then(run);
		this.turn = result.catch(() => undefined);
		return result;
	}
}
