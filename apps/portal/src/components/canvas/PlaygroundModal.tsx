import { CloseButton, Modal, Tabs } from "@fluxify/components";
import { type ReactNode, useState } from "react";
import { useCanvasPlayground } from "./PlaygroundContext";

type PlaygroundTab = "playground" | "track";

/**
 * Canvas-owned shell. Its content supplies its own controls, title, and frame.
 * With `trackExecution` the header becomes a tab strip. The playground stays
 * mounted while hidden so a sent request survives a look at the recording;
 * Track Execution mounts only while selected, so its polling stops with it.
 */
export function PlaygroundModal({
	children,
	trackExecution,
}: {
	children: ReactNode;
	trackExecution?: ReactNode;
}) {
	const playground = useCanvasPlayground();
	const [tab, setTab] = useState<PlaygroundTab>("playground");
	const shown = trackExecution ? tab : "playground";
	return (
		<Modal isOpen={playground.isOpen} onOpenChange={playground.onOpenChange}>
			<Modal.Backdrop>
				<Modal.Container placement="center" size="cover" className="p-0">
					<Modal.Dialog
						aria-label="API Playground"
						className="flex h-[min(820px,86vh)] w-[min(1600px,96vw)] !max-w-none flex-col overflow-hidden border border-border bg-background p-0 shadow-2xl shadow-black/50"
					>
						<Modal.Header className="flex h-11 shrink-0 flex-row items-center border-b border-border px-4 py-0">
							{trackExecution ? (
								<Tabs
									variant="secondary"
									selectedKey={tab}
									onSelectionChange={(key) => setTab(key as PlaygroundTab)}
								>
									<Tabs.ListContainer className="flex-none">
										<Tabs.List aria-label="Playground views" className="h-full w-auto min-w-0">
											<Tabs.Tab id="playground" className="whitespace-nowrap">
												API Playground
												<Tabs.Indicator />
											</Tabs.Tab>
											<Tabs.Tab id="track" className="whitespace-nowrap">
												Track Execution
												<Tabs.Indicator />
											</Tabs.Tab>
										</Tabs.List>
									</Tabs.ListContainer>
								</Tabs>
							) : (
								<Modal.Heading className="text-sm font-semibold">API Playground</Modal.Heading>
							)}
							<CloseButton aria-label="Close API Playground" className="ml-auto" />
						</Modal.Header>
						<Modal.Body className="min-h-0 flex-1 p-0">
							<div className={shown === "playground" ? "h-full" : "hidden"}>{children}</div>
							{shown === "track" && trackExecution}
						</Modal.Body>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
