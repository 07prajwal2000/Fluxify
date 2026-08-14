import { Modal, CloseButton } from "@fluxify/components";
import type { ReactNode } from "react";
import { useCanvasPlayground } from "./PlaygroundContext";

/** Canvas-owned shell. Its content supplies its own controls, title, and frame. */
export function PlaygroundModal({ children }: { children: ReactNode }) {
	const playground = useCanvasPlayground();
	return (
		<Modal isOpen={playground.isOpen} onOpenChange={playground.onOpenChange}>
			<Modal.Backdrop>
				<Modal.Container placement="center" size="cover" className="p-0">
					<Modal.Dialog className="flex h-[min(820px,86vh)] w-[min(1600px,96vw)] !max-w-none flex-col overflow-hidden border border-border bg-background p-0 shadow-2xl shadow-black/50">
						<Modal.Header className="flex h-11 shrink-0 flex-row items-center border-b border-border px-4 py-0">
							<Modal.Heading className="text-sm font-semibold">API Playground</Modal.Heading>
							<CloseButton aria-label="Close API Playground" className="ml-auto" />
						</Modal.Header>
						<Modal.Body className="min-h-0 flex-1 p-0">{children}</Modal.Body>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
