#!/usr/bin/env node
/**
 * Writes the updated brain server.js with 4-layer workflow support.
 * Run: node scripts/update-brain-server.mjs
 */
import { writeFileSync } from "fs"

const BRAIN_SERVER = "C:/Users/user/brain/src/server.js"

const content = `// Central Brain MCP Server v2.0
// 4-layer workflow: Claude thinks → Hermes 3 researches/analyzes → qwen2.5-coder implements → Claude reviews
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { remember, recall, forget, listMemories, listCollections, getStats } from './memory.js';
import {
  askHermes, askCoder, checkOllama,
  webSearch, fetchPage,
  hermesResearch, hermesAnalyzeTask, hermesRetrieve, hermesCollectContext,
} from './ollama.js';

const server = new McpServer({ name: 'brain', version: '2.0.0' });

// ─── LAYER 2: HERMES 3 — WEB SEARCH ──────────────────────────────────────────

server.tool('web_search',
  'Search the web (DuckDuckGo, free). Use before coding with unfamiliar APIs or libraries.',
  { query: z.string().describe('Search query'), limit: z.number().optional().describe('Max results (default 5)') },
  async ({ query, limit = 5 }) => {
    try {
      const r = await webSearch(query, limit);
      if (!r.ok || !r.results.length) return { content: [{ type: 'text', text: 'No results for: ' + query }] };
      const text = r.results.map((x, i) => '[' + (i+1) + '] ' + x.title + '\\n' + x.snippet + '\\n' + x.url).join('\\n\\n');
      return { content: [{ type: 'text', text: 'Search: "' + query + '"\\n\\n' + text }] };
    } catch (e) { return { content: [{ type: 'text', text: 'Error: ' + e.message }], isError: true }; }
  }
);

server.tool('fetch_page',
  'Fetch and extract readable text from a URL. Use after web_search to read specific pages.',
  { url: z.string(), max_chars: z.number().optional() },
  async ({ url, max_chars = 3000 }) => {
    try {
      const r = await fetchPage(url, max_chars);
      if (!r.ok) return { content: [{ type: 'text', text: 'Failed: ' + r.error }], isError: true };
      return { content: [{ type: 'text', text: 'From ' + url + ':\\n\\n' + r.text }] };
    } catch (e) { return { content: [{ type: 'text', text: 'Error: ' + e.message }], isError: true }; }
  }
);

server.tool('research',
  'Hermes 3 as Researcher: web search + memory recall + synthesis. Returns key findings, best practices, sources. Use to investigate any tech topic before coding.',
  { topic: z.string(), collection: z.string().optional(), memory_limit: z.number().optional() },
  async ({ topic, collection, memory_limit = 4 }) => {
    try {
      const memories = await recall(topic, collection || null, memory_limit);
      const result = await hermesResearch(topic, memories);
      return { content: [{ type: 'text', text: result + (memories.length ? '\\n\\n*[' + memories.length + ' memories used]*' : '') }] };
    } catch (e) { return { content: [{ type: 'text', text: 'Error: ' + e.message }], isError: true }; }
  }
);

// ─── LAYER 2: HERMES 3 — PROJECT ANALYST ─────────────────────────────────────

server.tool('analyze_task',
  'Hermes 3 as Project Analyst: analyzes a task with code context + past lessons. Returns relevant files, patterns, risks, recommended approach. Run before code_pro for complex tasks.',
  {
    task: z.string(),
    code_context: z.string().optional().describe('Paste relevant existing code'),
    collection: z.string().optional(),
    memory_limit: z.number().optional(),
  },
  async ({ task, code_context = '', collection, memory_limit = 5 }) => {
    try {
      const memories = await recall(task, collection || 'code', memory_limit);
      const result = await hermesAnalyzeTask(task, code_context, memories);
      return { content: [{ type: 'text', text: result + (memories.length ? '\\n\\n*[' + memories.length + ' past lessons used]*' : '') }] };
    } catch (e) { return { content: [{ type: 'text', text: 'Error: ' + e.message }], isError: true }; }
  }
);

// ─── LAYER 2: HERMES 3 — MEMORY RETRIEVER ────────────────────────────────────

server.tool('retrieve_context',
  'Hermes 3 as Memory Retriever: finds and ranks past lessons most relevant to a task. Returns scored lessons, known pitfalls, established patterns. Use at the START of every task.',
  { task: z.string(), collection: z.string().optional(), limit: z.number().optional() },
  async ({ task, collection, limit = 8 }) => {
    try {
      const memories = await recall(task, collection || null, limit);
      if (!memories.length) return { content: [{ type: 'text', text: 'No relevant memories found.' }] };
      const result = await hermesRetrieve(task, memories);
      return { content: [{ type: 'text', text: result }] };
    } catch (e) { return { content: [{ type: 'text', text: 'Error: ' + e.message }], isError: true }; }
  }
);

// ─── LAYER 2: HERMES 3 — CONTEXT COLLECTOR (main orchestrator) ───────────────

server.tool('collect_context',
  'Hermes 3 as Context Collector: THE pre-coding intelligence step. Runs web research + memory retrieval + task analysis → single context package for the coder. Use before any substantial coding task.',
  {
    task: z.string().describe('What needs to be built — be specific'),
    code_context: z.string().optional(),
    research_topic: z.string().optional().describe('Web search query (defaults to task)'),
    web_search: z.boolean().optional().describe('Enable web research (default: true)'),
    collection: z.string().optional(),
    memory_limit: z.number().optional(),
  },
  async ({ task, code_context = '', research_topic = '', web_search: doSearch = true, collection, memory_limit = 6 }) => {
    try {
      const memories = await recall(task, collection || 'code', memory_limit);
      const result = await hermesCollectContext(task, {
        codeContext: code_context,
        webSearch: doSearch,
        memories,
        researchTopic: research_topic || task,
      });
      return { content: [{ type: 'text', text: result + '\\n\\n*[' + memories.length + ' memories + web research included]*' }] };
    } catch (e) { return { content: [{ type: 'text', text: 'Error: ' + e.message }], isError: true }; }
  }
);

// ─── LAYER 2: HERMES 3 — GENERAL Q&A ─────────────────────────────────────────

server.tool('ask_hermes3',
  'Ask Hermes 3 a question using the developer system prompt.',
  { prompt: z.string() },
  async ({ prompt }) => {
    try { return { content: [{ type: 'text', text: await askHermes(prompt) }] }; }
    catch (e) { return { content: [{ type: 'text', text: 'Error: ' + e.message }], isError: true }; }
  }
);

server.tool('ask_hermes3_with_memory',
  'Ask Hermes 3 with automatic RAG context retrieval from memory.',
  { prompt: z.string(), collection: z.string().optional(), memory_limit: z.number().optional() },
  async ({ prompt, collection, memory_limit = 5 }) => {
    try {
      const memories = await recall(prompt, collection || null, memory_limit);
      const response = await askHermes(prompt, null, memories);
      const note = memories.length > 0
        ? '\\n\\n*[' + memories.length + ' memories from: ' + [...new Set(memories.map(m => m.collection))].join(', ') + ']*'
        : '\\n\\n*[No relevant memories found]*';
      return { content: [{ type: 'text', text: response + note }] };
    } catch (e) { return { content: [{ type: 'text', text: 'Error: ' + e.message }], isError: true }; }
  }
);

// ─── LAYER 3: CODER — qwen2.5-coder ──────────────────────────────────────────

server.tool('code',
  'qwen2.5-coder:7b — fast coder for quick edits and small functions (1-3s response time).',
  { prompt: z.string(), context: z.string().optional() },
  async ({ prompt, context }) => {
    try {
      const full = context ? 'Context:\\n' + context + '\\n\\n---\\n\\n' + prompt : prompt;
      return { content: [{ type: 'text', text: await askCoder(full, 'qwen2.5-coder:7b') }] };
    } catch (e) { return { content: [{ type: 'text', text: 'Error: ' + e.message }], isError: true }; }
  }
);

server.tool('code_pro',
  'qwen3:14b — heavy coder for complex multi-file work. Best results when given collect_context output as context.',
  { prompt: z.string(), context: z.string().optional() },
  async ({ prompt, context }) => {
    try {
      const full = context ? 'Context:\\n' + context + '\\n\\n---\\n\\n' + prompt : prompt;
      return { content: [{ type: 'text', text: await askCoder(full, 'qwen3:14b') }] };
    } catch (e) { return { content: [{ type: 'text', text: 'Error: ' + e.message }], isError: true }; }
  }
);

server.tool('code_with_memory',
  'qwen3:14b + automatic RAG memory injection. Best for project-aware tasks that should follow existing patterns.',
  {
    prompt: z.string(),
    collection: z.string().optional(),
    memory_limit: z.number().optional(),
    fast: z.boolean().optional().describe('Use 7b instead of 14b (default: false)'),
  },
  async ({ prompt, collection, memory_limit = 5, fast = false }) => {
    try {
      const memories = await recall(prompt, collection || 'code', memory_limit);
      const model = fast ? 'qwen2.5-coder:7b' : 'qwen3:14b';
      const response = await askCoder(prompt, model, null, memories);
      return { content: [{ type: 'text', text: response + (memories.length ? '\\n\\n*[' + memories.length + ' memories injected]*' : '') }] };
    } catch (e) { return { content: [{ type: 'text', text: 'Error: ' + e.message }], isError: true }; }
  }
);

// ─── WARMUP ───────────────────────────────────────────────────────────────────

server.tool('warmup',
  'Pre-warm all Ollama models into RAM. Run at session start for zero cold-start latency. With 64GB RAM all models stay loaded simultaneously.',
  {},
  async () => {
    const models = ['hermes3', 'qwen2.5-coder:7b', 'qwen3:14b', 'nomic-embed-text'];
    const results = [];
    for (const model of models) {
      try {
        const res = await fetch(process.env.OLLAMA_HOST + '/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, stream: false, keep_alive: '24h', messages: [{ role: 'user', content: 'hi' }] }),
        });
        const ok = res.ok || res.status === 200;
        results.push(model + ': ' + (ok ? 'warmed' : 'failed (' + res.status + ')'));
      } catch (e) { results.push(model + ': error - ' + e.message); }
    }
    return { content: [{ type: 'text', text: 'Warmup complete:\\n' + results.join('\\n') + '\\n\\nAll models loaded in RAM. Keep-alive: 24h.' }] };
  }
);

// ─── MEMORY ───────────────────────────────────────────────────────────────────

server.tool('remember',
  'Store content in shared RAG memory (accessible by Claude + Hermes 3 + coders).',
  { content: z.string(), collection: z.string().optional(), tags: z.array(z.string()).optional() },
  async ({ content, collection = 'general', tags = [] }) => {
    try {
      const id = await remember(content, collection, { tags });
      return { content: [{ type: 'text', text: 'Stored (id: ' + id + ', collection: ' + collection + ')' }] };
    } catch (e) { return { content: [{ type: 'text', text: 'Error: ' + e.message }], isError: true }; }
  }
);

server.tool('recall',
  'Semantic search over stored memories.',
  { query: z.string(), collection: z.string().optional(), limit: z.number().optional() },
  async ({ query, collection, limit = 5 }) => {
    try {
      const results = await recall(query, collection || null, limit);
      if (!results.length) return { content: [{ type: 'text', text: 'No relevant memories found.' }] };
      const text = results.map((r, i) => '[' + (i+1) + '] (' + r.collection + ', ' + r.score.toFixed(3) + ')\\n' + r.content).join('\\n\\n');
      return { content: [{ type: 'text', text: text }] };
    } catch (e) { return { content: [{ type: 'text', text: 'Error: ' + e.message }], isError: true }; }
  }
);

server.tool('forget', 'Delete a memory by ID.',
  { id: z.string() },
  async ({ id }) => {
    const removed = forget(id);
    return { content: [{ type: 'text', text: removed ? 'Deleted ' + id : 'Not found: ' + id }] };
  }
);

server.tool('list_memories', 'List memories, optionally filtered by collection.',
  { collection: z.string().optional() },
  async ({ collection }) => {
    const entries = listMemories(collection || null);
    if (!entries.length) return { content: [{ type: 'text', text: 'No memories yet.' }] };
    return { content: [{ type: 'text', text: entries.map(e => '[' + e.id + '] (' + e.collection + ') ' + e.content).join('\\n') }] };
  }
);

server.tool('list_collections', 'List all collections with entry counts.', {},
  async () => {
    const cols = listCollections();
    return { content: [{ type: 'text', text: cols.length ? cols.map(c => '- ' + c.name + ': ' + c.count).join('\\n') : 'No collections yet.' }] };
  }
);

// ─── STATUS ───────────────────────────────────────────────────────────────────

server.tool('brain_status', 'Full brain health: models, memory, workflow summary.', {},
  async () => {
    const ollama = await checkOllama();
    const stats = getStats();
    return { content: [{ type: 'text', text: [
      '## Brain v2.0 — 4-Layer Workflow', '',
      '### Models',
      'Hermes 3 (researcher/analyst/memory/retriever): ' + (ollama.hermesReady ? 'READY' : 'MISSING'),
      'qwen2.5-coder (implementer):                    ' + (ollama.coderReady ? 'READY' : 'MISSING'),
      'phi4 (deep reasoning):                          ' + (ollama.phi4Ready ? 'READY' : 'optional'),
      'nomic-embed-text (embeddings):                  ' + (ollama.embedReady ? 'READY' : 'MISSING'),
      ollama.ok ? 'All loaded: ' + ollama.models.join(', ') : 'ERROR: ' + ollama.error,
      '', '### Memory',
      'Total: ' + stats.total + ' | ' + stats.collections.map(c => c.name + '(' + c.count + ')').join(', '),
      '', '### 4-Layer Workflow',
      '1. Claude:   plan + retrieve_context',
      '2. Hermes 3: collect_context / research / analyze_task',
      '3. Coder:    code / code_pro / code_with_memory',
      '4. Claude:   review + remember',
      '', '### Quick Commands',
      'warmup()          - load all models into RAM (run at session start!)',
      'collect_context() - full pre-coding intelligence brief',
      'research()        - web search + memory synthesis',
    ].join('\\n') }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
`

writeFileSync(BRAIN_SERVER, content, "utf8")
console.log("✅ Brain server.js updated with 4-layer workflow")
console.log("   New tools: web_search, fetch_page, research, analyze_task, retrieve_context, collect_context, warmup")
console.log("   Restart Claude Code to reconnect the brain MCP server")
