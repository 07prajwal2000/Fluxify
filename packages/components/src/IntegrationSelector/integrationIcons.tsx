import type { ReactNode } from "react";
import { BiLogoPostgresql, BiLogoMongodb } from "react-icons/bi";
import { DiRedis, DiMysql } from "react-icons/di";
import { SiAnthropic } from "react-icons/si";
import { TbBrandFirebase, TbBrandSupabase, TbServer } from "react-icons/tb";
import { RiGeminiFill, RiOpenaiLine, RiRobot2Fill, RiOpenaiFill } from "react-icons/ri";
import { PiNotebookLight } from "react-icons/pi";
import { IoTelescope } from "react-icons/io5";

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
};
