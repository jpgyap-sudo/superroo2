# Telegram Response Skill

Format responses appropriately for the Telegram messaging platform.

## Formatting Rules

1. **Markdown**: Use Telegram-compatible Markdown:
   - `*bold*` for emphasis
   - `_italic_` for subtle emphasis
   - `\`code\`` for technical terms, file paths, commands
   - ``` ```code block``` ``` for multi-line code or structured data

2. **Length**: Keep responses concise. Telegram is a chat platform:
   - Short answers: 1-3 paragraphs
   - Long explanations: Break into sections with headers
   - Max 4000 characters per message (Telegram limit)

3. **Structure**:
   - Start with a direct answer
   - Follow with supporting details
   - End with a clear next step or call to action

4. **Emoji Usage**: Use emoji sparingly for visual cues:
   - ✅ Success / Complete
   - ❌ Error / Failed
   - 🚀 Deployment / Launch
   - 🔧 Coding / Fixing
   - 🧠 Analysis / Research
   - ℹ️ Information
   - ⚠️ Warning

5. **Actions**: When routing to another agent, clearly state:
   - What task is being created
   - Which agent will handle it
   - Expected timeline

6. **Error Handling**: If something goes wrong:
   - Acknowledge the error
   - Explain what happened in simple terms
   - Provide the next step to resolve it
