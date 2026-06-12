import { useAppTranslation } from "@src/i18n/TranslationContext"
import CodeBlock from "./CodeBlock"

interface MermaidBlockProps {
	code: string
}

// Lightweight stub — mermaid rendering disabled to avoid circular dependency
// at module load time. Re-enable by restoring the full MermaidBlock implementation.
export default function MermaidBlock({ code }: MermaidBlockProps) {
	const { t } = useAppTranslation()
	return <CodeBlock language="mermaid" source={code} />
}
