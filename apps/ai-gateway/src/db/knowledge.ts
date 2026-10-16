import { logger } from "@fluxify/common";
import {
	CHAN_ON_KNOWLEDGE_SOURCE_CHANGE,
	db,
	knowledgeSourcesEntity,
	subscribeToChannel,
} from "@fluxify/server";
import { and, eq } from "drizzle-orm";
import { type DocSection, kbPageSections, setProjectKB } from "./vector";

/** Rebuild the knowledge base index of one project, or of every project. */
export async function loadKnowledgeBase(projectId?: string) {
	const enabled = eq(knowledgeSourcesEntity.enabled, true);
	const rows = await db
		.select({
			projectId: knowledgeSourcesEntity.projectId,
			name: knowledgeSourcesEntity.name,
			pages: knowledgeSourcesEntity.pages,
		})
		.from(knowledgeSourcesEntity)
		.where(projectId ? and(enabled, eq(knowledgeSourcesEntity.projectId, projectId)) : enabled);
	const byProject = new Map<string, DocSection[]>(projectId ? [[projectId, []]] : []);
	for (const r of rows)
		byProject.set(r.projectId, [
			...(byProject.get(r.projectId) ?? []),
			...kbPageSections(r.name, r.pages),
		]);
	for (const [id, sections] of byProject) setProjectKB(id, sections);
}

/** Load every project's knowledge base, then follow changes from the admin server. */
export async function initKnowledgeBase() {
	await loadKnowledgeBase();
	await subscribeToChannel(CHAN_ON_KNOWLEDGE_SOURCE_CHANGE, (projectId) =>
		loadKnowledgeBase(projectId).catch((error) =>
			logger.error(`Reloading knowledge base of ${projectId} failed`, { error }),
		),
	);
	logger.info("Initialized knowledge base", "DocsDB");
}
