import { Button, CloseButton, Input, Label, Modal, TextField, toast } from "@fluxify/components";
import { useState } from "react";
import { LuImport } from "react-icons/lu";
import { parseApiError, showErrorNotification } from "@/lib/errorNotifier";
import { transferQuery } from "@/query/transferQuery";
import { type ResourceType, transferService } from "@/services/transfer";
import { BundlePreview } from "./BundlePreview";
import { capitalize, conflictNotice, type FieldKey, importDefaults, resourceOf } from "./resources";
import { pickBundleFile, readBundleFile } from "./transferFile";

type Values = Partial<Record<FieldKey, string>>;

/** A picked file waiting for the user to confirm, with the values it will take. */
type Pending = {
	bundle: Awaited<ReturnType<typeof readBundleFile>>;
	values: Values;
	/** what already exists here, as found when the file was picked */
	notice?: string;
	error?: string;
};

type ImportButtonProps = {
	resourceType: ResourceType;
	projectId: string;
	/** opens the created resource; the page owns navigation */
	onOpen: (id: string) => void;
};

/** Picks an exported file, shows what is in it, and creates the resource once confirmed. */
export function ImportButton({ resourceType, projectId, onOpen }: ImportButtonProps) {
	const resource = resourceOf(resourceType);
	const { label } = resource;
	const importBundle = transferQuery.import.mutation(resourceType);
	const [pending, setPending] = useState<Pending | null>(null);
	// set when the import left something out: the user reads it before opening the resource
	const [result, setResult] = useState<{ id: string; warnings: string[] } | null>(null);

	const pick = async () => {
		const file = await pickBundleFile(resourceType);
		if (!file) return;
		try {
			const bundle = await readBundleFile(file, resourceType);
			// asked before the dialog opens, so a clash is already dealt with when it does
			const { taken } = await transferService.checkImport(resourceType, projectId, bundle);
			setPending({
				bundle,
				values: importDefaults(resource, bundle, taken),
				notice: conflictNotice(resource, bundle, taken),
			});
		} catch (error) {
			showErrorNotification(error);
		}
	};

	const confirm = async () => {
		if (!pending) return;
		try {
			const done = await importBundle.mutateAsync({
				projectId,
				bundle: resource.write(pending.bundle, pending.values),
			});
			setPending(null);
			if (done.warnings.length > 0) return setResult(done);
			toast.success(`${capitalize(label)} imported`);
			onOpen(done.id);
		} catch (error) {
			const { status, message } = parseApiError(error);
			// a name or path already taken stays in the dialog, where it can be changed
			if (status === 409) return setPending({ ...pending, error: message });
			showErrorNotification(error);
		}
	};

	const edit = (key: FieldKey, value: string) =>
		setPending((p) =>
			p ? { ...p, values: { ...p.values, [key]: value }, notice: undefined, error: undefined } : p,
		);

	return (
		<>
			<Button variant="outline" onPress={pick}>
				<LuImport size={16} /> Import
			</Button>
			<Modal isOpen={pending !== null} onOpenChange={(isOpen) => !isOpen && setPending(null)}>
				<Modal.Backdrop>
					<Modal.Container placement="center" size="lg">
						<Modal.Dialog className="w-full !max-w-6xl max-h-[90vh]">
							<Modal.Header className="flex flex-row items-center justify-between">
								<Modal.Heading>Import this {label}?</Modal.Heading>
								<CloseButton />
							</Modal.Header>
							<Modal.Body className="grid min-h-0 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
								<div className="flex flex-col gap-3">
									<p className="text-sm text-muted">
										This creates a new {label} in this project
										{pending?.bundle.suites
											? ` with its ${pending.bundle.suites.length} test suite(s)`
											: ""}
										. The blocks inside it are on the right: click one to see its settings.
									</p>
									{resource.fields.map((field) => (
										<TextField
											key={field.key}
											value={pending?.values[field.key] ?? ""}
											onChange={(value) => edit(field.key, value)}
										>
											<Label>{field.label}</Label>
											<Input className={field.mono ? "font-mono" : undefined} />
										</TextField>
									))}
									{pending?.notice && <p className="text-sm text-warning">{pending.notice}</p>}
									{pending?.error && <p className="text-sm text-danger">{pending.error}</p>}
								</div>
								{pending && <BundlePreview bundle={pending.bundle} />}
							</Modal.Body>
							<Modal.Footer>
								<Button variant="ghost" onPress={() => setPending(null)}>
									Cancel
								</Button>
								<Button variant="primary" isPending={importBundle.isPending} onPress={confirm}>
									Import
								</Button>
							</Modal.Footer>
						</Modal.Dialog>
					</Modal.Container>
				</Modal.Backdrop>
			</Modal>
			<Modal isOpen={result !== null} onOpenChange={(isOpen) => !isOpen && setResult(null)}>
				<Modal.Backdrop>
					<Modal.Container placement="center" size="md">
						<Modal.Dialog>
							<Modal.Header className="flex flex-row items-center justify-between">
								<Modal.Heading>{capitalize(label)} imported with changes</Modal.Heading>
								<CloseButton />
							</Modal.Header>
							<Modal.Body className="flex flex-col gap-2">
								<p className="text-sm text-muted">
									The {label} was created. Some things didn't exist in this project and were left
									out:
								</p>
								<ul className="list-disc space-y-1 pl-5 text-sm">
									{result?.warnings.map((warning) => (
										<li key={warning}>{warning}</li>
									))}
								</ul>
							</Modal.Body>
							<Modal.Footer>
								<Button variant="ghost" onPress={() => setResult(null)}>
									Stay here
								</Button>
								<Button
									variant="primary"
									onPress={() => {
										if (result) onOpen(result.id);
										setResult(null);
									}}
								>
									Open {label}
								</Button>
							</Modal.Footer>
						</Modal.Dialog>
					</Modal.Container>
				</Modal.Backdrop>
			</Modal>
		</>
	);
}
