import { z } from "zod";
import { responseSchema } from "./dto";

export default function handleRequest(): Promise<z.infer<typeof responseSchema>> {
  return {} as any;
}
      