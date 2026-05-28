# SkillOpt Analysis: What SuperRoo Can Adopt & Improve

> **Source**: [microsoft/SkillOpt](https://github.com/microsoft/SkillOpt) — "Executive Strategy for Self-Evolving Agent Skills"
> **Paper**: arXiv 2605.23904

---

## Executive Summary

SkillOpt introduces **ReflACT** — a 6-stage training pipeline that treats agent skill documents (prompts/rules) as trainable parameters, analogous to neural network weights. It uses LLMs as optimizers to propose, rank, merge, and apply edits to skill documents, with epoch-level longitudinal analysis and meta-learning. This is **directly applicable** to SuperRoo's skill system, lesson learning layer, and agent routing.

---

## 1. Core Architecture: The ReflACT Pipeline

SkillOpt's training loop mirrors neural network training with these analogies:

| Neural Network Concept | SkillOpt ReflACT                         | SuperRoo Equivalent                                   |
| ---------------------- | ---------------------------------------- | ----------------------------------------------------- |
| Model weights          | Skill document (`.md` prompt)            | Skills in `.roo/skills/`, `memory/lessons-learned.md` |
| Training data          | Benchmark tasks (train split)            | Coding tasks, deployments, bug fixes                  |
| Forward pass           | **Rollout** (execute agent with skill)   | Agent execution with current rules                    |
| Loss computation       | **Reflect** (analyze failures/successes) | Lesson extraction, bug analysis                       |
| Gradient accumulation  | **Aggregate** (hierarchical patch merge) | Multi-agent lesson consolidation                      |
| Gradient clipping      | **Select** (rank & top-L edits)          | Lesson relevance ranking                              |
| Optimizer step         | **Update** (apply edits to skill)        | Skill file updates                                    |
| Validation             | **Evaluate** (gate: accept/reject)       | Test suite, deployment health checks                  |
| Learning rate          | **Edit budget** (max edits per step)     | — (missing in SuperRoo)                               |
| Epoch                  | Full pass over training data             | Sprint / release cycle                                |
| Slow weights (EMA)     | **Slow Update** (protected section)      | — (missing in SuperRoo)                               |
| Meta-learning          | **Meta Skill** (optimizer-side memory)   | Lesson summaries, Central Brain                       |

---

## 2. What SuperRoo Should Adopt (High Priority)

### 2.1. The 6-Stage Training Loop

SuperRoo currently has **ad-hoc skill improvement** — lessons are extracted but never systematically applied back to skills. We need a formal loop:

```
① Rollout   → Execute agent with current skill on benchmark tasks
② Reflect   → Analyze trajectories, generate candidate edits
③ Aggregate → Hierarchically merge edits from multiple analysts
④ Select    → Rank edits by impact, keep top-L (edit budget)
⑤ Update    → Apply edits to skill document
⑥ Evaluate  → Validate candidate skill, accept/reject
```

**Implementation**: Create [`src/super-roo/skill-optimizer/ReflACTTrainer.ts`](src/super-roo/skill-optimizer/ReflACTTrainer.ts) — a TypeScript port of SkillOpt's trainer with SuperRoo-specific adapters.

### 2.2. Edit Budget as Learning Rate

SkillOpt treats the **maximum number of edits per step** as a learning rate, with schedulers:

- `constant` — fixed budget
- `linear` — linear decay
- `cosine` — cosine annealing
- `autonomous` — LLM decides the budget

**Why this matters**: Without an edit budget, every lesson extraction tries to apply all insights at once, causing skill bloat, contradictions, and regressions. A cosine-decay scheduler would let early steps make many changes (exploration) and later steps make few (convergence).

**Implementation**: Port [`skillopt/optimizer/scheduler.py`](skillopt/optimizer/scheduler.py) to [`src/super-roo/skill-optimizer/EditBudgetScheduler.ts`](src/super-roo/skill-optimizer/EditBudgetScheduler.ts).

### 2.3. Slow Update (Protected Skill Section)

SkillOpt's **slow update** is a **protected section** in the skill document (`<!-- SLOW_UPDATE_START -->...<!-- SLOW_UPDATE_END -->`) that:

1. Is **read-only** to step-level analysts (cannot be edited by per-step patches)
2. Is **overwritten only at epoch boundaries** by longitudinal comparison
3. Contains **strategic guidance** about regressions and persistent failures

**Why this is genius**: It separates **fast weights** (step-level tactical edits) from **slow weights** (epoch-level strategic guidance). This prevents the skill from oscillating — the slow section provides stable, long-term direction while the fast section adapts to recent failures.

**Implementation**: Add protected sections to SuperRoo skill files. The [`skillopt/optimizer/slow_update.py`](skillopt/optimizer/slow_update.py) module is a direct port target.

### 2.4. Meta Skill (Optimizer-Side Memory)

SkillOpt's **meta skill** is optimizer-facing memory that captures:

- Which edit types tend to help in this environment
- Which edit types tend to be too vague or harmful
- What failure-repair patterns should be prioritized
- What regression risks to guard against

This is **not** injected into the target agent's prompt — it's consumed by the optimizer (the LLM that generates edits) to improve future edit quality.

**Why this matters**: SuperRoo's lesson system currently stores lessons for the **agent** (target). We have no mechanism to improve the **optimizer itself**. A meta skill would make DeepSeek (our default coder) produce better edits over time.

**Implementation**: Port [`skillopt/optimizer/meta_skill.py`](skillopt/optimizer/meta_skill.py) and store meta skills in Central Brain alongside regular lessons.

### 2.5. Minibatch Trajectory Analysis

SkillOpt groups trajectories into **minibatches** (size M) and analyzes them together in a single LLM call, rather than per-trajectory analysis. This:

- Reduces LLM costs (one call per M trajectories instead of M calls)
- Identifies **common patterns** across failures (not edge cases)
- Produces **generalizable edits** rather than overfitted patches

**Implementation**: Port [`skillopt/gradient/reflect.py`](skillopt/gradient/reflect.py) — the `run_minibatch_reflect` function.

### 2.6. Hierarchical Patch Merging

When multiple analysts produce patches, SkillOpt merges them **hierarchically**:

```
Level 0: [patch₁, patch₂, patch₃, patch₄, patch₅, patch₆]  (6 patches)
Level 1: [merge(p₁,p₂,p₃), merge(p₄,p₅,p₆)]                (2 patches, parallel)
Level 2: [merge(level1₀, level1₁)]                          (1 patch)
```

Each level runs in parallel via `ThreadPoolExecutor`. Failure patches take priority over success patches.

**Implementation**: Port [`skillopt/gradient/aggregate.py`](skillopt/gradient/aggregate.py).

### 2.7. Validation Gate with Accept/Reject

SkillOpt's `evaluate_gate` is a pure function that compares candidate score vs current and best scores:

- `accept_new_best` — candidate beats all previous
- `accept` — candidate beats current but not best
- `reject` — candidate worse than current

**Why this matters**: SuperRoo currently applies every lesson extraction. A gate would prevent skill degradation from bad edits.

**Implementation**: Port [`skillopt/evaluation/gate.py`](skillopt/evaluation/gate.py).

---

## 3. What SuperRoo Should Improve (Innovations)

### 3.1. Multi-Model Optimizer Routing

SkillOpt uses a single optimizer model. SuperRoo should use **model routing** for different stages:

| Stage                         | Recommended Model        | Rationale                               |
| ----------------------------- | ------------------------ | --------------------------------------- |
| Rollout (execution)           | DeepSeek (default coder) | Fast, cheap, good at coding             |
| Reflect (failure analysis)    | DeepSeek R1 / Claude     | Deep reasoning, chain-of-thought        |
| Aggregate (merge)             | GPT-4o / Claude          | Best at synthesis and deduplication     |
| Select (ranking)              | DeepSeek V3              | Fast, cheap, good at classification     |
| Update (apply edits)          | DeepSeek (default coder) | Same model as execution for consistency |
| Slow Update (strategic)       | Claude / GPT-4o          | Best at long-range strategic thinking   |
| Meta Skill (optimizer memory) | DeepSeek R1              | Deep reasoning about optimizer behavior |

**Innovation**: A [`ModelRouter`](src/super-roo/skill-optimizer/ModelRouter.ts) that routes each stage to the optimal model based on cost, latency, and capability requirements.

### 3.2. Skill Versioning with Rollback

SkillOpt saves skill snapshots per step. SuperRoo should add:

- **Git-based skill versioning** — each skill update is a git commit with the skill hash
- **Automatic rollback** — if the validation gate rejects 3 consecutive candidates, roll back to the last best skill
- **Skill diff visualization** — show what changed between skill versions in the dashboard

**Innovation**: Integrate with [`CommitDeployLog`](src/super-roo/product-memory/CommitDeployLog.ts) to track skill versions alongside code commits.

### 3.3. Cross-Project Skill Transfer

SkillOpt trains skills per-benchmark. SuperRoo should:

- **Transfer slow update guidance** across projects (e.g., "always validate JSON before parsing" applies to any project)
- **Weight skills by project similarity** — use pgvector embeddings to find relevant skills from other projects
- **Federated skill learning** — aggregate edits from multiple projects into a shared skill

**Innovation**: Build on SuperRoo's existing [cross-project learning layer](AGENTS.md#cross-project-learning-layer) to include skill transfer.

### 3.4. Autonomous Edit Budget with Confidence

SkillOpt's autonomous LR asks the optimizer "how many edits?" but doesn't consider **confidence**. SuperRoo should add:

- **Confidence-weighted edit budgets** — low confidence → fewer edits (conservative), high confidence → more edits (aggressive)
- **Uncertainty-aware ranking** — edits with high support count but low confidence get demoted
- **Exploration bonus** — periodically increase edit budget to explore new patterns

**Innovation**: A Bayesian-inspired edit budget system that tracks the optimizer's confidence over time.

### 3.5. Skill Compression via Distillation

SkillOpt's skills grow monotonically. SuperRoo should add:

- **Periodic skill distillation** — use an LLM to compress the skill document, removing redundant or outdated rules
- **Token budget enforcement** — cap skill length and force the optimizer to be concise
- **Skill pruning** — remove rules that haven't been triggered in N epochs

**Innovation**: A [`SkillCompressor`](src/super-roo/skill-optimizer/SkillCompressor.ts) that runs every K epochs to prevent skill bloat.

### 3.6. Real-Time Skill Evaluation

SkillOpt evaluates on a held-out validation set. SuperRoo should:

- **Evaluate skills on live deployments** — track pass/fail rates of deployed agents and correlate with skill versions
- **A/B test skill variants** — deploy different skill versions to different agents and compare outcomes
- **Automated regression detection** — if a skill update causes a deployment health check to fail, auto-rollback

**Innovation**: Close the loop between skill optimization and deployment monitoring.

### 3.7. Prompt Engineering as a First-Class Pipeline

SkillOpt's prompts are markdown files with structured JSON output schemas. SuperRoo should adopt this pattern for **all** agent prompts:

- **Prompt versioning** — each prompt has a version hash
- **Prompt testing** — unit tests for prompt outputs (schema validation)
- **Prompt A/B testing** — deploy different prompt variants to different agents
- **Prompt optimization** — use the ReflACT loop to optimize prompts themselves

**Innovation**: A [`PromptRegistry`](src/super-roo/prompts/PromptRegistry.ts) that manages prompt versions, tests, and deployments.

---

## 4. Implementation Roadmap

### Phase 1: Foundation (Week 1-2)

| Task                                         | Files                                                                                                          | Priority |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------- |
| Port edit budget scheduler                   | [`src/super-roo/skill-optimizer/EditBudgetScheduler.ts`](src/super-roo/skill-optimizer/EditBudgetScheduler.ts) | P0       |
| Port validation gate                         | [`src/super-roo/skill-optimizer/ValidationGate.ts`](src/super-roo/skill-optimizer/ValidationGate.ts)           | P0       |
| Port skill edit operations                   | [`src/super-roo/skill-optimizer/SkillEditor.ts`](src/super-roo/skill-optimizer/SkillEditor.ts)                 | P0       |
| Add protected slow update sections to skills | [`src/super-roo/skill-optimizer/SlowUpdateField.ts`](src/super-roo/skill-optimizer/SlowUpdateField.ts)         | P0       |

### Phase 2: Training Loop (Week 3-4)

| Task                       | Files                                                                                                      | Priority |
| -------------------------- | ---------------------------------------------------------------------------------------------------------- | -------- |
| Port minibatch reflect     | [`src/super-roo/skill-optimizer/MinibatchReflect.ts`](src/super-roo/skill-optimizer/MinibatchReflect.ts)   | P1       |
| Port hierarchical merge    | [`src/super-roo/skill-optimizer/HierarchicalMerge.ts`](src/super-roo/skill-optimizer/HierarchicalMerge.ts) | P1       |
| Port edit ranking/clipping | [`src/super-roo/skill-optimizer/EditRanker.ts`](src/super-roo/skill-optimizer/EditRanker.ts)               | P1       |
| Build ReflACT trainer      | [`src/super-roo/skill-optimizer/ReflACTTrainer.ts`](src/super-roo/skill-optimizer/ReflACTTrainer.ts)       | P1       |

### Phase 3: Epoch-Level (Week 5-6)

| Task               | Files                                                                                          | Priority |
| ------------------ | ---------------------------------------------------------------------------------------------- | -------- |
| Port slow update   | [`src/super-roo/skill-optimizer/SlowUpdate.ts`](src/super-roo/skill-optimizer/SlowUpdate.ts)   | P1       |
| Port meta skill    | [`src/super-roo/skill-optimizer/MetaSkill.ts`](src/super-roo/skill-optimizer/MetaSkill.ts)     | P2       |
| Build model router | [`src/super-roo/skill-optimizer/ModelRouter.ts`](src/super-roo/skill-optimizer/ModelRouter.ts) | P2       |

### Phase 4: SuperRoo Innovations (Week 7-8)

| Task                         | Files                                                                                                            | Priority |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------- |
| Skill versioning + rollback  | [`src/super-roo/skill-optimizer/SkillVersioning.ts`](src/super-roo/skill-optimizer/SkillVersioning.ts)           | P2       |
| Cross-project skill transfer | [`src/super-roo/skill-optimizer/CrossProjectTransfer.ts`](src/super-roo/skill-optimizer/CrossProjectTransfer.ts) | P2       |
| Skill compression            | [`src/super-roo/skill-optimizer/SkillCompressor.ts`](src/super-roo/skill-optimizer/SkillCompressor.ts)           | P2       |
| Real-time evaluation         | [`src/super-roo/skill-optimizer/LiveEvaluator.ts`](src/super-roo/skill-optimizer/LiveEvaluator.ts)               | P3       |

---

## 5. Key Differences & Adaptations

| Aspect         | SkillOpt                         | SuperRoo Adaptation                       |
| -------------- | -------------------------------- | ----------------------------------------- |
| Language       | Python                           | TypeScript                                |
| Model backend  | Azure OpenAI, Claude, Codex      | DeepSeek, Claude, Ollama, GPT-4o          |
| Data format    | Benchmark JSON (train/val/test)  | Git commits, deployment logs, bug reports |
| Skill format   | Markdown document                | Markdown with YAML frontmatter            |
| Execution env  | ALFWorld, SearchQA, DocVQA, etc. | VS Code, Telegram, Cloud dashboard        |
| Parallelism    | Ray, ThreadPoolExecutor          | Worker threads, MCP server                |
| Persistence    | Local filesystem                 | Central Brain (pgvector), local JSONL     |
| Resume support | Runtime state JSON               | CommitDeployLog + runtime state           |
| Token tracking | Per-stage counters               | MCP token usage tracking                  |

---

## 6. Prompt Architecture to Port

SkillOpt's prompts are the secret sauce. These should be ported to SuperRoo's prompt system:

| Prompt File                                                 | Purpose                                             | SuperRoo Location                                                                                                      |
| ----------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| [`analyst_error.md`](skillopt/prompts/analyst_error.md)     | Analyze failed trajectories, propose edits          | [`src/super-roo/skill-optimizer/prompts/analyst-error.md`](src/super-roo/skill-optimizer/prompts/analyst-error.md)     |
| [`analyst_success.md`](skillopt/prompts/analyst_success.md) | Analyze successful trajectories, reinforce patterns | [`src/super-roo/skill-optimizer/prompts/analyst-success.md`](src/super-roo/skill-optimizer/prompts/analyst-success.md) |
| [`merge_failure.md`](skillopt/prompts/merge_failure.md)     | Merge failure-driven patches                        | [`src/super-roo/skill-optimizer/prompts/merge-failure.md`](src/super-roo/skill-optimizer/prompts/merge-failure.md)     |
| [`merge_success.md`](skillopt/prompts/merge_success.md)     | Merge success-driven patches                        | [`src/super-roo/skill-optimizer/prompts/merge-success.md`](src/super-roo/skill-optimizer/prompts/merge-success.md)     |
| [`merge_final.md`](skillopt/prompts/merge_final.md)         | Final merge (failure priority)                      | [`src/super-roo/skill-optimizer/prompts/merge-final.md`](src/super-roo/skill-optimizer/prompts/merge-final.md)         |
| [`ranking.md`](skillopt/prompts/ranking.md)                 | Rank edits by importance                            | [`src/super-roo/skill-optimizer/prompts/ranking.md`](src/super-roo/skill-optimizer/prompts/ranking.md)                 |
| [`slow_update.md`](skillopt/prompts/slow_update.md)         | Epoch-level strategic guidance                      | [`src/super-roo/skill-optimizer/prompts/slow-update.md`](src/super-roo/skill-optimizer/prompts/slow-update.md)         |
| [`meta_skill.md`](skillopt/prompts/meta_skill.md)           | Optimizer-side memory                               | [`src/super-roo/skill-optimizer/prompts/meta-skill.md`](src/super-roo/skill-optimizer/prompts/meta-skill.md)           |
| [`lr_autonomous.md`](skillopt/prompts/lr_autonomous.md)     | Autonomous edit budget                              | [`src/super-roo/skill-optimizer/prompts/lr-autonomous.md`](src/super-roo/skill-optimizer/prompts/lr-autonomous.md)     |

---

## 7. Integration with Existing SuperRoo Systems

```
                    ┌─────────────────────────────┐
                    │     ReflACT Trainer          │
                    │  (new: skill-optimizer/)     │
                    └──────────┬──────────────────┘
                               │
          ┌────────────────────┼────────────────────┐
          ▼                    ▼                    ▼
┌──────────────────┐  ┌────────────────┐  ┌──────────────────┐
│  Lesson System   │  │  Central Brain │  │  CommitDeployLog │
│  (existing)      │  │  (existing)    │  │  (existing)      │
│                  │  │                │  │                  │
│  Lessons become  │  │  Meta skills   │  │  Skill versions  │
│  training data   │  │  stored here   │  │  tracked here    │
└──────────────────┘  └────────────────┘  └──────────────────┘

          ┌────────────────────┼────────────────────┐
          ▼                    ▼                    ▼
┌──────────────────┐  ┌────────────────┐  ┌──────────────────┐
│  Skill Files     │  │  Agent Router  │  │  Dashboard       │
│  (.roo/skills/)  │  │  (existing)    │  │  (existing)      │
│                  │  │                │  │                  │
│  Target of edits │  │  Routes to     │  │  Visualize skill │
│  + slow update   │  │  optimized     │  │  evolution       │
│  sections        │  │  skills        │  │                  │
└──────────────────┘  └────────────────┘  └──────────────────┘
```

---

## 8. Risk Mitigation

| Risk                                                       | Mitigation                                                                          |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **Skill bloat** — skills grow unbounded                    | Skill compression every K epochs, token budget enforcement                          |
| **Catastrophic forgetting** — new edits break old patterns | Validation gate with accept/reject, automatic rollback                              |
| **LLM cost explosion** — too many optimizer calls          | Minibatch analysis (M trajectories per call), hierarchical merge                    |
| **Overfitting** — skill memorizes training tasks           | Held-out validation set, cosine LR decay, slow update regularization                |
| **Oscillation** — skill alternates between two states      | Slow update provides stable long-term guidance                                      |
| **Cold start** — no training data initially                | Start with existing lessons as training data, bootstrap with synthetic trajectories |

---

## 9. Conclusion

SkillOpt's ReflACT pipeline is the most important advancement in agent skill optimization since the concept of skill documents themselves. SuperRoo is uniquely positioned to adopt and improve it because:

1. **We already have the data** — lessons, bugs, deployments, and trajectories
2. **We already have the infrastructure** — Central Brain, pgvector, MCP servers
3. **We already have the models** — DeepSeek, Claude, Ollama, GPT-4o
4. **We already have the feedback loop** — deployments, health checks, commit logs

The key insight from SkillOpt is that **skill optimization is not prompt engineering** — it's a **training process** with epochs, batches, learning rates, validation gates, and regularization. By treating skills as trainable parameters, we can systematically improve agent performance rather than relying on ad-hoc prompt tweaks.

**The 7 innovations** (multi-model routing, skill versioning, cross-project transfer, confidence-weighted budgets, skill compression, real-time evaluation, prompt-as-pipeline) would make SuperRoo's skill optimization system **strictly more capable** than SkillOpt while being deeply integrated with our existing infrastructure.
