# Phase 4 Prompt — Crawler Agent

Build the Crawler Agent for Super Roo.

Purpose:
Research official docs, changelogs, GitHub issues, and API references to support coding and debugging.

Requirements:
- URL fetcher with timeout
- HTML text extraction
- Source ranking
- Cache layer
- Respect max pages per crawl
- Return summarized implementation notes

Folder target:
`src/super-roo/crawler/`

Create:
- `crawler.ts`
- `docs-crawler.ts`
- `github-issues-crawler.ts`
- `changelog-crawler.ts`
- `source-ranker.ts`
- `crawl-cache.ts`
- `crawler.agent.ts`

Crawler output:
```json
{
  "query": "",
  "sourcesChecked": [],
  "bestSources": [],
  "summary": "",
  "implementationNotes": [],
  "warnings": [],
  "confidence": "low|medium|high"
}
```

Add tests with mocked HTML responses.
