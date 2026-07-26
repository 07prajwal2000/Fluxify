import { useEffect, useState } from "react";
import {
	Button,
	Checkbox,
	Input,
	Label,
	Modal,
	Spinner,
	TextField,
	toast,
} from "@fluxify/components";
import { appConfigQuery } from "@/query/appConfigQuery";
import { showErrorNotification } from "@/lib/errorNotifier";
import type { ConfigRow } from "./types";

const ENCODINGS = ["plaintext", "base64", "hex"] as const;

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

	const [keyName, setKeyName] = useState(config.keyName);
	const [description, setDescription] = useState("");
	const [value, setValue] = useState("");
	const [booleanValue, setBooleanValue] = useState(false);
	const [isEncrypted, setIsEncrypted] = useState(config.isEncrypted);
	const [encoding, setEncoding] = useState<(typeof ENCODINGS)[number]>(config.encodingType);

	useEffect(() => {
		if (detail) {
			setKeyName(detail.keyName);
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
				keyName,
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
				<Modal.Container placement="center" size="sm">
					<Modal.Dialog>
						<Modal.Header>
							<Modal.Heading>Edit config key: {config.keyName}</Modal.Heading>
						</Modal.Header>
						{isLoading ? (
							<div className="flex justify-center py-8">
								<Spinner />
							</div>
						) : (
							<form onSubmit={submit}>
								<Modal.Body>
									<div className="flex flex-col gap-4">
										<TextField isRequired value={keyName} onChange={setKeyName}>
											<Label>Key name</Label>
											<Input />
										</TextField>

										<div className="flex flex-col gap-1 text-sm">
											<span className="font-medium text-muted">Data Type</span>
											<span className="font-mono text-sm font-semibold capitalize">{config.dataType}</span>
										</div>

										{config.dataType === "boolean" ? (
											<Checkbox isSelected={booleanValue} onChange={setBooleanValue}>
												<Checkbox.Content>
													<Checkbox.Control>
														<Checkbox.Indicator />
													</Checkbox.Control>
													<Label>Boolean Value: {booleanValue ? "True" : "False"}</Label>
												</Checkbox.Content>
											</Checkbox>
										) : (
											<TextField isRequired value={value} onChange={setValue}>
												<Label>Value</Label>
												<Input
													type={config.dataType === "number" ? "number" : "text"}
												/>
											</TextField>
										)}

										<TextField value={description} onChange={setDescription}>
											<Label>Description</Label>
											<Input placeholder="What this key controls" />
										</TextField>

										<div className="flex flex-col gap-1.5">
											<Label>Encoding</Label>
											<div className="flex gap-1.5">
												{ENCODINGS.map((enc) => (
													<Button
														key={enc}
														type="button"
														size="sm"
														variant={encoding === enc ? "primary" : "outline"}
														onPress={() => setEncoding(enc)}
													>
														{enc}
													</Button>
												))}
											</div>
										</div>

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
