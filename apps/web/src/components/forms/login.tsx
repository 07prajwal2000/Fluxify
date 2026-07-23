"use client";

import { authClient } from "@/lib/auth";
import { showErrorNotification } from "@/lib/errorNotifier";
import {
	Box,
	Button,
	Divider,
	PasswordInput,
	Stack,
	Text,
	TextInput,
	Title,
	Group,
	ThemeIcon,
	Image,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { isAxiosError } from "axios";
import { useRouter, useSearchParams } from "next/navigation";
import React, { useEffect, useState } from "react";
import { TbHexagonLetterF } from "react-icons/tb";

const LoginForm = () => {
	const router = useRouter();
	const params = useSearchParams();
	const form = useForm({ initialValues: { email: "", password: "" } });
	const [loading, setLoading] = useState(false);
	const [ssoLoading, setSsoLoading] = useState(false);
	const [ssoConfig, setSsoConfig] = useState<{
		enabled: boolean;
		providerId: string;
	} | null>(null);

	// Public, unauthenticated: tells us whether SSO is enabled and which
	// provider to sign in with.
	useEffect(() => {
		fetch("/_/admin/api/public-settings", { credentials: "include" })
			.then((r) => r.json())
			.then((data) => {
				const sso = data?.sso_config;
				if (sso?.enabled) {
					setSsoConfig({ enabled: true, providerId: sso.providerId ?? "enterprise" });
				}
			})
			.catch(() => {});
	}, []);

	const onSsoLogin = async () => {
		setSsoLoading(true);
		try {
			const searchParams = new URLSearchParams(params.toString());
			const callbackURL = searchParams.get("next") || "/_/admin/ui/";
			const res = await fetch("/_/admin/api/auth/sign-in/sso", {
				method: "POST",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					providerId: ssoConfig?.providerId,
					callbackURL,
					errorCallbackURL: `/_/admin/ui/login?next=${encodeURIComponent(callbackURL)}`,
				}),
			});
			const data = await res.json();
			if (res.ok && data?.url) {
				window.location.href = data.url;
				return;
			}
			notifications.show({
				title: "Failed to start SSO login",
				message: data?.message || "Something went wrong.",
				color: "red",
			});
		} catch (error) {
			showErrorNotification(error as Error, false);
		} finally {
			setSsoLoading(false);
		}
	};

	const onSubmit = async (values: { email: string; password: string }) => {
		setLoading(true);
		const searchParams = new URLSearchParams(params.toString());
		try {
			const result = await authClient.signIn.email(values);
			if (result.error) {
				notifications.show({
					title: "Failed to login",
					message: result.error.message,
					color: "red",
				});
			}
			if (result.data?.user) {
				notifications.show({
					title: "Logged in successfully",
					message: "Logged-in as " + result.data?.user?.email,
					color: "green",
				});
				if (searchParams.get("next")) {
					router.replace(searchParams.get("next") || "/");
				} else {
					router.replace("/");
				}
			}
		} catch (error) {
			if (isAxiosError(error) && error.response?.data.type === "validation") {
				form.setErrors(error.response?.data.errors);
			} else {
				showErrorNotification(error as Error, false);
			}
			console.log(error);
		} finally {
			setLoading(false);
		}
	};

	return (
		<Box w="100%" style={{ fontFamily: "Inter, sans-serif" }}>
			<form onSubmit={form.onSubmit(onSubmit)}>
				<Stack gap="xl">
					{/* Logo and Header */}
					<Stack gap="sm" align="center" mb="md">
						<Box mb="xs">
							<Image
								src="/_/admin/ui/logo_title.webp"
								alt="Fluxify Logo"
								height={40}
								fit="contain"
							/>
						</Box>
						<Title
							order={2}
							c="#111417"
							style={{
								fontFamily: "Hanken Grotesk, sans-serif",
								fontWeight: 700,
							}}
						>
							Welcome back
						</Title>
						<Text c="#464749" size="sm" ta="center">
							Sign in to your account to continue
						</Text>
					</Stack>

					{/* Inputs */}
					<Stack gap="md">
						<TextInput
							label="Email address"
							placeholder="name@company.com"
							type="email"
							required
							size="md"
							{...form.getInputProps("email")}
						/>
						<PasswordInput
							label="Password"
							placeholder="Enter your password"
							required
							size="md"
							className="modern-input"
							{...form.getInputProps("password")}
						/>
					</Stack>

					{/* Actions */}
					<Stack gap="sm" mt="xs">
						<Button
							type="submit"
							w="100%"
							size="md"
							radius="md"
							loading={loading}
							style={{
								backgroundColor: "#7432df",
								color: "#ffffff",
								fontFamily: "Inter, sans-serif",
								fontWeight: 600,
							}}
						>
							Sign In
						</Button>

						<Divider
							my="xs"
							label="OR"
							labelPosition="center"
							color="#e3e2e4"
							styles={{
								label: { color: "#8d9195", backgroundColor: "transparent" },
							}}
						/>

						<Button
							type="button"
							variant="outline"
							w="100%"
							size="md"
							radius="md"
							loading={ssoLoading}
							style={{
								borderColor: "#e3e2e4",
								color: "#111417",
								fontFamily: "Inter, sans-serif",
								fontWeight: 600,
							}}
							onClick={() =>
								ssoConfig
									? onSsoLogin()
									: notifications.show({
											title: "SSO Login",
											message: "SSO Login is not configured yet.",
											color: "blue",
										})
							}
						>
							Login with SSO
						</Button>
					</Stack>
				</Stack>
			</form>
		</Box>
	);
};

export default LoginForm;
