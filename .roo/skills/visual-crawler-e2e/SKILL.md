---
name: visual-crawler-e2e
description: Automated visual regression testing using Playwright screenshots + Ollama Vision analysis + agent-driven bug fixing. Use when testing UI changes, detecting regressions, or verifying visual consistency across viewports.
---

# Visual Crawler E2E Testing

Automated visual regression testing using Playwright + Ollama Vision + agent-driven bug fixing.

## Architecture

```
Baseline Capture → Playwright Crawler → Multi-Viewport Matrix → Screenshot →
{Pixel Diff | SSIM | Ollama Vision} → Bug Hunter Agent → Debugger Agent →
Fix Verification Loop
```

## Components

| File | Purpose |
|------|---------|
| `VisualCrawler.ts` | Main orchestrator — runs the full pipeline |
| `BaselineManager.ts` | Captures golden baselines; compares new screenshots |
| `ViewportMatrix.ts` | Defines viewport/theme/auth combinations to test |
| `ScreenshotAnalyzer.ts` | Sends screenshots to Ollama Vision for analysis |
| `BugReportBuilder.ts` | Creates structured bug reports from findings |
| `FixVerifier.ts` | Re-runs tests after fixes to verify resolution |

## Ollama Vision Model Selection

Given VPS specs (2 vCPU, 4GB RAM):

| Model | Size | RAM | Speed | Use Case |
|-------|------|-----|-------|----------|
| `gemma3:4b` | 4B | ~3GB | Fast | Primary visual analysis |
| `llava-phi3` | 3.8B | ~2.5GB | Fast | Quick smoke tests |
| `minicpm-v` | 8B | ~5GB | Medium | Deep analysis (if resources allow) |

**Pull command**: `ollama pull gemma3:4b`

## Viewport Matrix

Default matrix tests 6 combinations:
- Desktop: 1920x1080
- Laptop: 1366x768
- Tablet: 768x1024
- Mobile: 390x844
- Themes: dark, light
- Auth: logged-in, logged-out

## Baseline Workflow

1. **First run**: Capture baselines → store in `cloud/e2e/baselines/`
2. **Subsequent runs**: Compare against baseline → detect regressions
3. **Update baselines**: `npx playwright test --update-baselines`

## Bug Report Format

```json
{
  "id": "bug-uuid",
  "severity": "critical|high|medium|low",
  "type": "regression|new_bug|layout|color|accessibility",
  "viewport": "1920x1080-dark",
  "page": "/ide-terminal",
  "description": "Button 'Send' is cut off at right edge",
  "diffImage": "path/to/diff.png",
  "screenshot": "path/to/screenshot.png",
  "baseline": "path/to/baseline.png"
}
```

## Fix Verification Loop

1. Bug detected → Bug Hunter creates report
2. Debugger Agent applies fix → commits to branch
3. CI deploys to staging
4. FixVerifier re-runs SAME test on staging
5. If fixed → merge PR; If not → retry (max 3)

## Running Tests

```bash
cd cloud/dashboard
npx playwright test e2e/visual-crawler/
```

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/visual-crawl/analyze` | POST | Send screenshot to Ollama Vision |
| `/api/visual-crawl/baseline` | GET/POST | Manage baselines |
| `/api/visual-crawl/report` | POST | Submit bug report |
