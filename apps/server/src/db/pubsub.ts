import { closeNats, initializeNats, natsPublish, natsSubscribe } from "./nats";

export const CHAN_ON_ROUTE_CHANGE = "chan:on-route-change";
export const CHAN_ON_APPCONFIG_CHANGE = "chan:on-appconfig-change";
export const CHAN_ON_INTEGRATION_CHANGE = "chan:on-integration-change";
export const CHAN_AI_WORKER = "chan:ai-worker";
export const CHAN_AI_SSE_PREFIX = "chan:ai-sse:";
export const CHAN_ON_PROJECT_SETTING_CHANGE = "chan:on-project-setting-change";
export const CHAN_ON_CUSTOM_BLOCK_CHANGE = "chan:on-custom-block-change";
export const CHAN_ON_INSTANCE_SETTING_CHANGE = "chan:on-instance-setting-change";

/** Connect the pub/sub backend (NATS). Call once at startup before publishing/subscribing. */
export async function initializePubSub() {
	await initializeNats();
}

/** Drain and close the pub/sub backend. Call on graceful shutdown. */
export async function closePubSub() {
	await closeNats();
}

export async function publishMessage(chan: string, data: string | object) {
	natsPublish(chan, typeof data === "object" ? JSON.stringify(data) : data);
}

export async function subscribeToChannel(
	chan: string,
	callback: (data: string) => void,
) {
	return natsSubscribe(chan, callback);
}
