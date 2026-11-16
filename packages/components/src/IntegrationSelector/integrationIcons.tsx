import type { ReactNode } from "react";
import { BiLogoMongodb, BiLogoPostgresql } from "react-icons/bi";
import { DiMysql } from "react-icons/di";
import { IoTelescope } from "react-icons/io5";
import { PiNotebookLight } from "react-icons/pi";
import { RiGeminiFill, RiOpenaiFill, RiOpenaiLine } from "react-icons/ri";
import { SiAnthropic, SiApachekafka, SiNatsdotio, SiRabbitmq, SiRedis } from "react-icons/si";
import { TbBrandAws, TbBrandFirebase, TbBrandSupabase, TbServer } from "react-icons/tb";

import { VscMcp } from "react-icons/vsc";

const size = 20;

// The portal's base path (the portal is served under one); "/" anywhere else.
const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/";

// Brand artwork in the portal's public/integrations. A picture, so it keeps its own
// colours instead of taking the theme tint the react-icons glyphs get.
const brandImage = (file: string) => (
	<img src={`${base}integrations/${file}`} alt="" width={size} height={size} />
);

// Keyed by integration variant (server humanReadable variant names).
export const integrationIcons: Record<string, ReactNode> = {
	PostgreSQL: <BiLogoPostgresql size={size} />,
	MongoDB: <BiLogoMongodb size={size} />,
	MySQL: <DiMysql size={size} />,
	Redis: <SiRedis size={size} />,
	Memcached: <TbServer size={size} />,
	Supabase: <TbBrandSupabase size={size} />,
	Firebase: <TbBrandFirebase size={size} />,
	"OpenAI Compatible": <RiOpenaiLine size={size} />,
	Anthropic: <SiAnthropic size={size} />,
	OpenAI: <RiOpenaiFill size={size} />,
	Mistral: brandImage("mistral.webp"),
	Gemini: <RiGeminiFill size={size} />,
	"Open Telemetry": <IoTelescope size={size} />,
	Loki: <PiNotebookLight size={size} />,
	Kafka: <SiApachekafka size={size} />,
	NATS: <SiNatsdotio size={size} />,
	SQS: <TbBrandAws size={size} />,
	RabbitMQ: <SiRabbitmq size={size} />,
	"S3 Compatible": brandImage("s3.svg"),
	http: <VscMcp size={size} />,
	mcp: <VscMcp size={size} />,
};
