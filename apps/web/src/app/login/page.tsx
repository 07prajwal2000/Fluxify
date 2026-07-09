"use server";
import LoginForm from "@/components/forms/login";
import { authClient } from "@/lib/auth";
import { loginQuotes } from "@/constants/loginQuotes";
import { Box, Center, Flex, Stack, Text, Title } from "@mantine/core";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import React from "react";

const LoginPage = async ({
	searchParams,
}: {
	searchParams: Promise<{ next?: string }>;
}) => {
	const headerObj = await headers();
	const session = await authClient.getSession({
		fetchOptions: { headers: headerObj },
	});

	if (session.data?.user) {
		return redirect((await searchParams).next || "/");
	}

	const randomQuote = loginQuotes[Math.floor(Math.random() * loginQuotes.length)];

	return (
		<Flex w="100vw" h="100vh" bg="#ffffff">
			{/* Left Column - Image Placeholder (65%) */}
			<Box 
				w={{ base: "100%", md: "65%" }} 
				h="100%" 
				display={{ base: "none", md: "block" }}
				style={{
					borderRight: "1px solid rgba(0, 0, 0, 0.05)",
					background: "linear-gradient(135deg, #F8F9FA 0%, #e9ecef 100%)",
					position: "relative",
					overflow: "hidden"
				}}
			>
				{/* Connected nodes subtle motif */}
				<Box
					style={{
						position: "absolute",
						top: 0,
						left: 0,
						right: 0,
						bottom: 0,
						opacity: 0.2,
						backgroundImage: "radial-gradient(circle at 2px 2px, #d3bbff 1px, transparent 0)",
						backgroundSize: "32px 32px"
					}}
				/>
				<Center h="100%" p="xl" style={{ position: "relative", zIndex: 1 }}>
					<Stack align="center" gap="lg">
						<Box
							w={120}
							h={120}
							style={{
								borderRadius: "16px",
								background: "rgba(116, 50, 223, 0.05)",
								border: "1px dashed rgba(116, 50, 223, 0.2)",
								display: "flex",
								alignItems: "center",
								justifyContent: "center"
							}}
						>
							<Text c="#7432df" size="sm" fw={600}>Image Placeholder</Text>
						</Box>
						<Title order={2} c="#111417" style={{ fontFamily: "Hanken Grotesk, sans-serif", fontWeight: 800 }}>
							{randomQuote.title}
						</Title>
						<Text c="#464749" size="lg" ta="center" maw={400} style={{ fontFamily: "Inter, sans-serif" }}>
							{randomQuote.subtitle}
						</Text>
					</Stack>
				</Center>
			</Box>

			{/* Right Column - Login Form (35%) */}
			<Box w={{ base: "100%", md: "35%" }} h="100%" bg="#ffffff">
				<Center h="100%" p={{ base: "xl", md: "2xl" }}>
					<Box w="100%" maw={420}>
						<LoginForm />
					</Box>
				</Center>
			</Box>
		</Flex>
	);
};

export default LoginPage;
