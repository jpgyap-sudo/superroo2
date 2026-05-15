import js from "@eslint/js"
import eslintConfigPrettier from "eslint-config-prettier"
import onlyWarn from "eslint-plugin-only-warn"
import globals from "globals"

export default [
	js.configs.recommended,
	eslintConfigPrettier,
	{
		plugins: {
			onlyWarn,
		},
	},
	{
		languageOptions: {
			globals: {
				...globals.node,
				...globals.es2021,
			},
		},
	},
	{
		ignores: ["dist/**", ".turbo/**"],
	},
	{
		rules: {
			"no-unused-vars": [
				"error",
				{
					argsIgnorePattern: "^_",
					varsIgnorePattern: "^_",
					caughtErrorsIgnorePattern: "^_",
				},
			],
		},
	},
]
