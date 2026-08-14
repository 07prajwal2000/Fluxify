import { useEffect, useState } from "react";
import {
	Button,
	Checkbox,
	CloseButton,
	Input,
	Label,
	Modal,
	Spinner,
	TextField,
	toast,
	CustomSelect,
} from "@fluxify/components";
import { TbBraces, TbLock } from "react-icons/tb";
import { appConfigQuery } from "@/query/appConfigQuery";
import { showErrorNotification } from "@/lib/errorNotifier";
import type { ConfigRow } from "./types";

const ENCODINGS = ["plaintext", "base64", "hex"] as const;
const DATA_TYPES = ["string", "number", "boolean"] as const;
const ENCODING_LABELS: Record<(typeof ENCODINGS)[number], string> = {
	plaintext: "Plain text",
	base64: "Base64",
	hex: "Hexadecimal",
};

export function EditConfigModal({
	projectId,
	config,
	onClose,
}: {
	projectId: string;
	config: ConfigRow;
	onClose: () => void;
}) {
	const { data: detail, isLoading } = appConfigQuery.getById.useQuery(projectId, config.id);
	const update = appConfigQuery.update.mutation(projectId, config.id);

	const [description, setDescription] = useState("");
	const [value, setValue] = useState("");
	const [booleanValue, setBooleanValue] = useState(false);
	const [isEncrypted, setIsEncrypted] = useState(config.isEncrypted);
	const [encoding, setEncoding] = useState<(typeof ENCODINGS)[number]>(config.encodingType);

	useEffect(() => {
		if (detail) {
			setDescription(detail.description || "");
			setIsEncrypted(detail.isEncrypted);
			setEncoding(detail.encodingType);
			if (detail.dataType === "boolean") {
				setBooleanValue(detail.value === "true");
			} else {
				setValue(String(detail.value ?? ""));
			}
		}
	}, [detail]);

	function submit(e: React.FormEvent) {
		e.preventDefault();
		const finalValue = config.dataType === "boolean" ? String(booleanValue) : String(value);

		update.mutate(
			{
				keyName: config.keyName,
				description,
				value: finalValue,
				isEncrypted,
				encodingType: encoding,
			},
			{
				onSuccess: () => {
					toast.success("Config updated");
					onClose();
				},
				onError: (err) => showErrorNotification(err as Error),
			},
		);
	}

	return (
		<Modal isOpen onOpenChange={(o) => !o && onClose()}>
			<Modal.Backdrop>
				<Modal.Container placement="center" scroll="inside" size="lg">
					<Modal.Dialog>
						<Modal.Header className="flex flex-row items-center justify-between">
							<Modal.Heading>Edit config key</Modal.Heading>
							<CloseButton onPress={onClose} />
						</Modal.Header>
						{isLoading ? (
							<div className="flex justify-center py-8">
								<Spinner />
							</div>
						) : (
							<form onSubmit={submit}>
								<Modal.Body>
									<div className="flex flex-col gap-4 pt-2">
										<div className="flex flex-col gap-1">
											<TextField value={config.keyName} isDisabled>
												<Label className="flex items-center gap-1.5 text-sm font-medium text-muted">
													<TbLock aria-hidden="true" size={16} /> Key name
												</Label>
												<Input className="font-mono" />
											</TextField>
											<p className="text-xs text-muted mt-1">
												Key names are permanent because they may be referenced throughout your application.
											</p>
										</div>

										<div className="grid grid-cols-2 gap-4 mt-2">
											<CustomSelect
												label={
													<div className="flex items-center gap-1.5 text-sm font-medium text-muted">
														<TbBraces size={16} /> Data type
													</div>
												}
												options={DATA_TYPES.map(dt => ({ value: dt, label: dt[0].toUpperCase() + dt.slice(1) }))}
												value={config.dataType}
												isDisabled
											/>

											<CustomSelect
												label={<span className="text-sm font-medium text-muted">Encoding</span>}
												options={ENCODINGS.map(enc => ({ value: enc, label: ENCODING_LABELS[enc] }))}
												value={encoding}
												onChange={(enc) => setEncoding(enc as any)}
											/>
										</div>

										{config.dataType === "boolean" ? (
											<div className="flex flex-col gap-1 mt-2">
												<Label className="text-sm font-medium text-foreground">Value</Label>
												<div className="rounded-lg border border-border p-2 bg-surface-50/50">
													<Checkbox isSelected={booleanValue} onChange={setBooleanValue}>
														<Checkbox.Content>
															<Checkbox.Control>
																<Checkbox.Indicator />
															</Checkbox.Control>
															<Label>Boolean Value: {booleanValue ? "True" : "False"}</Label>
														</Checkbox.Content>
													</Checkbox>
												</div>
											</div>
										) : (
											<div className="mt-2">
												<TextField isRequired value={value} onChange={setValue}>
													<Label>Value</Label>
													<Input
														type={config.dataType === "number" ? "number" : "text"}
														className="font-mono"
													/>
												</TextField>
											</div>
										)}

										<div className="mt-2">
											<TextField value={description} onChange={setDescription}>
												<Label>Description</Label>
												<Input placeholder="What this key controls" />
											</TextField>
										</div>

										<div className="mt-2 rounded-lg border border-border p-3 bg-surface-50/50">
											<Checkbox
												isSelected={isEncrypted}
												onChange={setIsEncrypted}
												isDisabled={config.isEncrypted}
											>
												<Checkbox.Content>
													<Checkbox.Control>
														<Checkbox.Indicator />
													</Checkbox.Control>
													<Label>{config.isEncrypted ? "Encrypted (cannot be decrypted)" : "Encrypt this value in storage"}</Label>
												</Checkbox.Content>
											</Checkbox>
										</div>
									</div>
								</Modal.Body>
								<Modal.Footer>
									<Button variant="ghost" onPress={onClose}>
										Cancel
									</Button>
									<Button type="submit" variant="primary" isPending={update.isPending}>
										Save changes
									</Button>
								</Modal.Footer>
							</form>
						)}
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
