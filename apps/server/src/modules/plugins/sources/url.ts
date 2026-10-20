import { and, eq } from "drizzle-orm";
import { db } from "../../../db";
import { pluginUrlRequestsEntity } from "../../../db/schema";
import { BadRequestError } from "../../../errors/badRequestError";
import { NotFoundError } from "../../../errors/notFoundError";
import { getSetting } from "../../../loaders/instanceSettingsLoader";
import { audit } from "../../audit";
import { assertCreator, type Caller } from "../service";
import { registerArchive } from "./archive";
import { assertTrustedUrl, downloadTrusted } from "./download";

/**
 * A plugin tarball at a URL, in two steps so the admin never reaches out on a
 * string a creator typed:
 *
 *   1. `requestUrlFetch`: the URL's host must be a trusted domain (an instance
 *      setting). It is recorded as `awaiting_fetch`; nothing is downloaded.
 *   2. `fetchApprovedUrl`: a creator lets the fetch happen. The admin downloads
 *      (every redirect re-checked), validates, stores in the Object Store like
 *      an upload and registers it, which leaves it pending for the usual approval.
 */
export type UrlRequest = typeof pluginUrlRequestsEntity.$inferSelect;

export const trustedDomains = () => getSetting("plugins")?.trustedDomains ?? [];

export async function requestUrlFetch(projectId: string, url: string, caller: Caller) {
	assertCreator(caller, projectId);
	// refused now, not at fetch time, so a typo or an untrusted host fails at once
	const clean = assertTrustedUrl(url, trustedDomains()).href;
	const [row] = await db
		.insert(pluginUrlRequestsEntity)
		.values({ projectId, url: clean, requestedBy: caller.user.id })
		.returning();
	await audit.record({
		projectId,
		resourceType: "plugin_url_request",
		resourceId: row!.id,
		action: "create",
		changedFields: ["url"],
		message: `Plugin download requested from ${new URL(clean).hostname}`,
	});
	return row!;
}

export const listUrlRequests = (projectId: string) =>
	db.select().from(pluginUrlRequestsEntity).where(eq(pluginUrlRequestsEntity.projectId, projectId));

export async function fetchApprovedUrl(projectId: string, id: string, caller: Caller) {
	assertCreator(caller, projectId);
	const [request] = await db
		.select()
		.from(pluginUrlRequestsEntity)
		.where(
			and(eq(pluginUrlRequestsEntity.id, id), eq(pluginUrlRequestsEntity.projectId, projectId)),
		);
	if (!request) throw new NotFoundError("There is no such plugin download request in this project");
	if (request.status === "fetched")
		throw new BadRequestError(`This URL was already fetched (plugin ${request.pluginName})`);

	const settle = (values: Partial<UrlRequest>) =>
		db
			.update(pluginUrlRequestsEntity)
			.set(values)
			.where(eq(pluginUrlRequestsEntity.id, id))
			.returning();
	try {
		// trusted domains may have changed since the request was made
		const tgz = await downloadTrusted(request.url, trustedDomains());
		const plugin = await registerArchive(projectId, tgz, "url", { url: request.url });
		await settle({
			status: "fetched",
			fetchedBy: caller.user.id,
			pluginName: plugin.name,
			lastError: null,
		});
		await audit.record({
			projectId,
			resourceType: "plugin_url_request",
			resourceId: id,
			action: "update",
			changedFields: ["status", "pluginName"],
			message: `Fetched ${plugin.name}@${plugin.version}`,
		});
		return plugin;
	} catch (error) {
		await settle({ status: "failed", lastError: (error as Error).message });
		throw error;
	}
}
