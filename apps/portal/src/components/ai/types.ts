export type AgentConversation = {
	id: string;
	title: string | null;
	status: string;
	pinned: boolean;
	archived: boolean;
	archivedAt?: string | Date | null;
	createdAt: string | Date;
	updatedAt: string | Date;
	userQuery?: string;
};
