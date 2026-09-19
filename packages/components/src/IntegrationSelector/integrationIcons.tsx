import type { ReactNode } from "react";
import { BiLogoMongodb, BiLogoPostgresql } from "react-icons/bi";
import { DiMysql, DiRedis } from "react-icons/di";
import { IoTelescope } from "react-icons/io5";
import { PiNotebookLight } from "react-icons/pi";
import { RiGeminiFill, RiOpenaiFill, RiOpenaiLine, RiRobot2Fill } from "react-icons/ri";
import { SiAnthropic, SiApachekafka, SiNatsdotio } from "react-icons/si";
import { TbBrandAws, TbBrandFirebase, TbBrandSupabase, TbServer } from "react-icons/tb";

const size = 20;

// Keyed by integration variant (server humanReadable variant names).
export const integrationIcons: Record<string, ReactNode> = {
	PostgreSQL: <BiLogoPostgresql size={size} />,
	MongoDB: <BiLogoMongodb size={size} />,
	MySQL: <DiMysql size={size} />,
	Redis: <DiRedis size={size} />,
	Memcached: <TbServer size={size} />,
	Supabase: <TbBrandSupabase size={size} />,
	Firebase: <TbBrandFirebase size={size} />,
	"OpenAI Compatible": <RiOpenaiLine size={size} />,
	Anthropic: <SiAnthropic size={size} />,
	OpenAI: <RiOpenaiFill size={size} />,
	Mistral: <RiRobot2Fill size={size} />,
	Gemini: <RiGeminiFill size={size} />,
	"Open Telemetry": <IoTelescope size={size} />,
	Loki: <PiNotebookLight size={size} />,
	Kafka: <SiApachekafka size={size} />,
	NATS: <SiNatsdotio size={size} />,
	SQS: <TbBrandAws size={size} />,
};
