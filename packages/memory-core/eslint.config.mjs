import { config } from "@superroo/config-eslint/base"

export default [
	...config,
	{
		ignores: ["dist/**", ".turbo/**"],
	},
]
