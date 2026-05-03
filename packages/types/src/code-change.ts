import { z } from "zod"

export const codeChangeSchema = z.object({
	id: z.string(),
	taskId: z.string(),
	timestamp: z.number(),
	filePath: z.string(),
	operation: z.enum(["create", "write", "diff", "edit", "patch", "delete"]),
	/** Previous file content (may be omitted if too large) */
	beforeContent: z.string().optional(),
	/** New file content (may be omitted if too large) */
	afterContent: z.string().optional(),
})

export type CodeChange = z.infer<typeof codeChangeSchema>
