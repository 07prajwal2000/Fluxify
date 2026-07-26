export type HarnessConversation = {
	id: string;
	title: string | null;
	status: string;
	pinned: boolean;
	archived: boolean;
	createdAt: string | Date;
	updatedAt: string | Date;
	userQuery?: string;
};
