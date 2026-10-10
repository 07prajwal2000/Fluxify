import {
	Button,
	Checkbox,
	CloseButton,
	CustomSelect,
	Input,
	Label,
	Modal,
	Spinner,
	TextField,
	toast,
} from "@fluxify/components";
import { useEffect, useState } from "react";
import { TbAlertTriangle, TbBraces, TbLock } from "react-icons/tb";
import { showErrorNotification } from "@/lib/errorNotifier";
import { appConfigQuery } from "@/query/appConfigQuery";
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
	const [devValue, setDevValue] = useState("");
	const [devBooleanValue, setDevBooleanValue] = useState<boolean | null>(null);
	const [syncDev, setSyncDev] = useState(false);
	const [isEncrypted, setIsEncrypted] = useState(config.isEncrypted);
	const [encoding, setEncoding] = useState<(typeof ENCODINGS)[number]>(config.encodingType);

	useEffect(() => {
		if (detail) {
			setDescription(detail.description || "");
			setIsEncrypted(detail.isEncrypted);
			setEncoding(detail.encodingType);
			setSyncDev(Boolean(detail.syncDev));
			if (detail.dataType === "boolean") {
				setBooleanValue(detail.value === "true");
				if (detail.devValue !== null && detail.devValue !== undefined) {
					setDevBooleanValue(detail.devValue === "true");
				} else {
					setDevBooleanValue(null);
				}
			} else {
				setValue(String(detail.value ?? ""));
				setDevValue(detail.devValue ?? "");
			}
		}
	}, [detail]);

	function submit(e: React.FormEvent) {
		e.preventDefault();
		const finalValue = config.dataType === "boolean" ? String(booleanValue) : String(value);

		// If encrypted and unchanged, omit value so the server preserves the stored ciphertext
		const valueUnchanged = detail?.isEncrypted && finalValue === detail?.value;

		let finalDevValue: string | null | undefined;
		if (syncDev) {
			finalDevValue = null;
		} else if (config.dataType === "boolean") {
			finalDevValue = devBooleanValue !== null ? String(devBooleanValue) : null;
		} else {
			if (devValue.trim() === "") {
				finalDevValue = null;
			} else if (detail?.isEncrypted && devValue === detail?.devValue) {
				// Encrypted dev secret unchanged -> omit devValue
				finalDevValue = undefined;
			} else {
				finalDevValue = devValue;
			}
		}

		update.mutate(
			{
				keyName: config.keyName,
				description,
				value: valueUnchanged ? undefined : finalValue,
				devValue: finalDevValue,
				syncDev,
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

	const devEmpty =
		config.dataType === "boolean" ? devBooleanValue === null : devValue.trim() === "";

	return (
		<Modal isOpen onOpenChange={(o) => !o && onClose()}>
			<Modal.Backdrop>
				<Modal.Container placement="center" scroll="inside" size="lg">
					<Modal.Dialog className="max-h-[90vh] sm:max-h-[85vh]">
						<Modal.Header className="flex flex-row items-center justify-between shrink-0">
							<Modal.Heading>Edit config key</Modal.Heading>
							<CloseButton onPress={onClose} />
						</Modal.Header>
						{isLoading ? (
							<div className="flex justify-center py-8">
								<Spinner />
							</div>
						) : (
							<form onSubmit={submit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
								<Modal.Body className="overflow-y-auto pr-1">
									<div className="flex flex-col gap-4 pt-2">
										<div className="flex flex-col gap-1">
											<TextField value={config.keyName} isDisabled>
												<Label className="flex items-center gap-1.5 text-sm font-medium text-muted">
													<TbLock aria-hidden="true" size={16} /> Key name
												</Label>
												<Input className="font-mono" />
											</TextField>
											<p className="text-xs text-muted mt-1">
												Key names are permanent because they may be referenced throughout your
												application.
											</p>
										</div>

										<div className="grid grid-cols-2 gap-4 mt-2">
											<CustomSelect
												label={
													<div className="flex items-center gap-1.5 text-sm font-medium text-muted">
														<TbBraces size={16} /> Data type
													</div>
												}
												options={DATA_TYPES.map((dt) => ({
													value: dt,
													label: dt[0].toUpperCase() + dt.slice(1),
												}))}
												value={config.dataType}
												isDisabled
											/>

											<CustomSelect
												label={<span className="text-sm font-medium text-muted">Encoding</span>}
												options={ENCODINGS.map((enc) => ({
													value: enc,
													label: ENCODING_LABELS[enc],
												}))}
												value={encoding}
												onChange={(enc) => setEncoding(enc as any)}
											/>
										</div>

										{config.dataType === "boolean" ? (
											<div className="flex flex-col gap-1 mt-2">
												<Label className="text-sm font-medium text-foreground">
													Production value
												</Label>
												<div className="rounded-lg border border-border p-2 bg-surface">
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
													<Label>Production value</Label>
													<Input
														type={config.dataType === "number" ? "number" : "text"}
														className="font-mono"
													/>
												</TextField>
											</div>
										)}

										<div className="flex flex-col gap-3 mt-2 rounded-lg border border-border p-3 bg-surface">
											<Checkbox
												isSelected={syncDev}
												onChange={setSyncDev}
												aria-label="Same as production"
											>
												<Checkbox.Content>
													<Checkbox.Control>
														<Checkbox.Indicator />
													</Checkbox.Control>
													<Label className="text-sm font-medium text-foreground cursor-pointer">
														Same as production
													</Label>
												</Checkbox.Content>
											</Checkbox>

											{syncDev ? (
												<div
													role="alert"
													className="rounded-xl border border-danger/30 bg-danger/10 p-4 text-danger"
												>
													<div className="flex items-start gap-3">
														<TbAlertTriangle size={20} className="shrink-0 mt-0.5 text-danger" />
														<div className="text-sm">
															<p className="font-semibold text-danger">Same as production</p>
															<p className="mt-1 text-xs text-danger/90">
																Dev runs, dev triggers and AI agents will read and write production
																— same database, same queues, same consumer groups. Use separate dev
																instances instead.
															</p>
														</div>
													</div>
												</div>
											) : (
												<div className="flex flex-col gap-2 pt-1">
													{devEmpty && (
														<p className="text-xs text-warning">
															Dev workers will fail until you set a development value or turn on
															Same as production.
														</p>
													)}
													{config.dataType === "boolean" ? (
														<CustomSelect
															label={
																<span className="text-sm font-medium text-foreground">
																	Development value
																</span>
															}
															options={[
																{ value: "", label: "Unset" },
																{ value: "true", label: "True" },
																{ value: "false", label: "False" },
															]}
															value={
																devBooleanValue === null ? "" : devBooleanValue ? "true" : "false"
															}
															onChange={(v) => {
																if (v === "") setDevBooleanValue(null);
																else setDevBooleanValue(v === "true");
															}}
														/>
													) : (
														<TextField value={devValue} onChange={setDevValue}>
															<Label>Development value</Label>
															<Input
																type={config.dataType === "number" ? "number" : "text"}
																className="font-mono"
															/>
														</TextField>
													)}
												</div>
											)}
										</div>

										<div className="mt-2">
											<TextField value={description} onChange={setDescription}>
												<Label>Description</Label>
												<Input placeholder="What this key controls" />
											</TextField>
										</div>

										<div className="mt-2 rounded-lg border border-border p-3 bg-surface">
											<Checkbox
												isSelected={isEncrypted}
												onChange={setIsEncrypted}
												isDisabled={config.isEncrypted}
											>
												<Checkbox.Content>
													<Checkbox.Control>
														<Checkbox.Indicator />
													</Checkbox.Control>
													<Label>
														{config.isEncrypted
															? "Encrypted (cannot be decrypted)"
															: "Encrypt this value in storage"}
													</Label>
												</Checkbox.Content>
											</Checkbox>
										</div>
									</div>
								</Modal.Body>
								<Modal.Footer className="shrink-0 pt-4">
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
