import { Button, CloseButton, Modal } from "@fluxify/components";
import { Link } from "@tanstack/react-router";
import type { RestoreResult } from "@/services/projects";

type Warning = RestoreResult["warnings"][number];

/** `Plugin "acme/kv" needs approving…` names the plugin whose page fixes it */
const pluginOf = (w: Warning) =>
	w.section === "plugins" ? /^Plugin "([^"]+)"/.exec(w.message)?.[1] : undefined;

/**
 * What to do after a restore that went through with warnings. `result.id` is the
 * new project; without one it was this project, rolled back in place.
 */
export function RestoredWithWarnings({
	result,
	onOpen,
	onClose,
}: {
	result: { id?: string; warnings: Warning[] };
	onOpen?: () => void;
	onClose: () => void;
}) {
	const projectId = result.id;
	return (
		<Modal isOpen onOpenChange={(isOpen) => !isOpen && onClose()}>
			<Modal.Backdrop>
				<Modal.Container placement="center" size="md">
					<Modal.Dialog>
						<Modal.Header className="flex flex-row items-center justify-between">
							<Modal.Heading>
								{result.id
									? "Project created, with a few things to do"
									: "Rolled back, with a few things to do"}
							</Modal.Heading>
							<CloseButton />
						</Modal.Header>
						<Modal.Body className="flex flex-col gap-2">
							<ul className="list-disc space-y-1 pl-5 text-sm">
								{result.warnings.map((w) => {
									const plugin = pluginOf(w);
									return (
										<li key={`${w.section}:${w.message}`}>
											{w.message}{" "}
											{plugin && projectId && (
												<Link
													to="/$projectId/settings"
													params={{ projectId }}
													search={{ tab: "plugins", plugin }}
													className="text-accent underline"
												>
													Open the plugin
												</Link>
											)}
										</li>
									);
								})}
							</ul>
						</Modal.Body>
						<Modal.Footer>
							{onOpen ? (
								<Button variant="primary" onPress={onOpen}>
									Open project
								</Button>
							) : (
								<Button variant="primary" onPress={onClose}>
									Done
								</Button>
							)}
						</Modal.Footer>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
