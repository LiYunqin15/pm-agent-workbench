import { z } from "zod";
import { DOCUMENT_FORMATS } from "@/lib/workspace/types";
import { DOCUMENT_TRANSFORM_ACTIONS } from "./transform";

export const documentTransformSchema = z.object({
  baseRevision: z.number().int().positive(),
  action: z.enum(DOCUMENT_TRANSFORM_ACTIONS),
  targetFormat: z.enum(DOCUMENT_FORMATS),
  destination: z.enum(["new_version", "new_document"]),
  instruction: z.string().trim().max(2_000).optional(),
}).strict();
