import fs from "fs"

const content = fs.readFileSync("memory/lessons-learned.md", "utf8")

const idx = content.indexOf("Unknown — extracted from commit 88bbdd66.")
if (idx === -1) {
  console.log("Lesson already updated or not found")
  process.exit(0)
}

const before = content.slice(0, idx)
const afterIdx = content.indexOf("---", idx)
const after = content.slice(afterIdx)

const newBlock = `#### Bug Cause
1. **provider-dashboard**: Used \`provider.latencyMs !== null\` which is \`true\` when \`latencyMs\` is \`undefined\`, then called \`.toFixed()\` on undefined. Also \`selectedProviderData.usage.latencyMs.toFixed(0)\` had no guard at all.
2. **visual-crawler**: Default state was hardcoded to \`http://localhost:3001\` which doesn't exist in production. API fetch for reports returned 404 for new projects which was not handled gracefully.
3. **autonomous-loop**: API returned 401 for users without loop permissions; UI rendered a raw red error card instead of a friendly setup message.

#### Fix Applied
1. Changed checks to \`typeof provider.latencyMs === "number"\` and added ternary guard for \`selectedProviderData.usage.latencyMs\`
2. Changed default URL to \`window.location.origin\` and handled 404 in fetchReports as empty state
3. Detected auth errors in autonomous-loop and rendered amber "not configured" card instead of red crash UI

#### Test Result
- Dashboard build passes (\`npm run build\` in cloud/dashboard)
- E2E tests: 3 passed, 2 expected failures (bugs on deployed site not yet deployed)
- Visual crawl re-run will confirm after deployment

#### Lesson Learned
Always guard \`.toFixed()\`, \`.toString()\`, and similar methods with \`typeof x === "number"\` rather than \`x !== null\`, because \`undefined !== null\` is \`true\` in JavaScript. Also, never hardcode \`localhost\` URLs in production UI components — derive from \`window.location.origin\` or environment variables.

#### Reusable Rule
**Rule: Number Method Guard Pattern**
Before calling \`.toFixed()\`, \`.toPrecision()\`, \`.toLocaleString()\`, or any Number prototype method, always verify with \`typeof value === "number"\`. Never rely on \`!== null\`, \`!= null\`, or truthiness checks because \`undefined\` and \`NaN\` can pass them and cause runtime crashes.

**Rule: No Localhost in Production Defaults**
Never hardcode \`http://localhost:*\` as default URLs in dashboard components. Use \`window.location.origin\` (client-side) or \`process.env.NEXT_PUBLIC_API_URL\` (build-time) with localhost as a fallback only.

#### Tags
bugfix, visual-crawler, dashboard, e2e, typescript-null-safety, production-defaults

---
`

fs.writeFileSync("memory/lessons-learned.md", before + newBlock + after)
console.log("Lesson updated")
