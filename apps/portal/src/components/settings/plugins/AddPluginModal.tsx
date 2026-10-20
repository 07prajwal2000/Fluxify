import { CloseButton, cn, Modal, toast } from "@fluxify/components";
import { useState } from "react";
import type { Plugin } from "@/services/plugins";
import { FolderTab, NpmTab, UploadTab, UrlTab } from "./AddPluginTabs";

const TABS = [
	{ id: "upload", label: "Upload", Tab: UploadTab },
	{ id: "npm", label: "npm", Tab: NpmTab },
	{ id: "url", label: "URL", Tab: UrlTab },
	{ id: "folder", label: "Folder", Tab: FolderTab },
] as const;

/**
 * Four ways in, one result: the plugin lands pending, and nothing in it loads
 * until a creator approves it from its page.
 */
export function AddPluginModal({
	projectId,
	isOpen,
	onOpenChange,
}: {
	projectId: string;
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const [active, setActive] = useState<(typeof TABS)[number]["id"]>("upload");
	const { Tab } = TABS.find((t) => t.id === active)!;

	function added(plugin: Plugin) {
		toast.success(`${plugin.name}@${plugin.version} added, waiting for approval`);
		onOpenChange(false);
	}

	return (
		<Modal isOpen={isOpen} onOpenChange={onOpenChange}>
			<Modal.Backdrop>
				<Modal.Container placement="center" scroll="inside" size="lg">
					<Modal.Dialog>
						<Modal.Header className="flex flex-row items-center justify-between">
							<Modal.Heading>Add plugin</Modal.Heading>
							<CloseButton />
						</Modal.Header>
						<Modal.Body>
							<div className="flex flex-col gap-4">
								<div role="tablist" className="flex gap-1 border-b border-border">
									{TABS.map((t) => (
										<button
											key={t.id}
											type="button"
											role="tab"
											aria-selected={active === t.id}
											onClick={() => setActive(t.id)}
											className={cn(
												"-mb-px border-b-2 px-3 py-1.5 text-sm font-medium transition-colors",
												active === t.id
													? "border-accent text-foreground"
													: "border-transparent text-muted hover:text-foreground",
											)}
										>
											{t.label}
										</button>
									))}
								</div>
								<Tab projectId={projectId} onAdded={added} />
							</div>
						</Modal.Body>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
