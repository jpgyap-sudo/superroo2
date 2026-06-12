---
description: Analyze an image using vision model (llava:7b or cloud vision)
---

# Analyze Image

This command analyzes images using the vision agent with llava:7b or cloud vision models.

## Usage

```
/analyze-image <image_path> [prompt]
```

## Examples

```
/analyze-image screenshot.png
/analyze-image diagram.png "Extract the architecture components and their connections"
/analyze-image error-dialog.png "What error message is shown and how to fix it?"
```

## Process

1. **Load Vision Agent** - Uses `.kilo/agent/vision.md` configuration
2. **Analyze Image** - Calls `brain_analyze_image` MCP tool
3. **Extract Information** - OCR, UI elements, diagrams, code
4. **Return Structured Output** - Text, components, insights

## Vision Models

| Model       | Size  | Use Case                    |
| ----------- | ----- | --------------------------- |
| `llava:7b` | 4.5GB | Local vision (default)      |
| `llava:13b`| 8.0GB | Complex images              |
| `bakllava:7b`| 4.5GB | Alternative vision model   |

## Prerequisites

```bash
# Pull vision model
ollama pull llava:7b

# Ensure Central Brain MCP is running
node scripts/central-brain-mcp.mjs
```

## Output Format

```markdown
## Image Analysis

### Image Type
- Screenshot / Diagram / Document

### Extracted Text
- All text found in image

### Key Elements
- UI components, buttons, forms

### Insights
- What the image shows
```