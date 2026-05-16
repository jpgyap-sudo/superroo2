# SuperRoo Architecture Diagrams

> All diagrams use [Mermaid](https://mermaid.js.org/) syntax and render natively in GitHub-flavored Markdown.

---

## Table of Contents

1. [High-Level System Architecture](#1-high-level-system-architecture)
2. [Healing Module Flow](#2-healing-module-flow)
3. [ML Engine Component Diagram](#3-ml-engine-component-diagram)
4. [Log Aggregation & Monitoring Pipeline](#4-log-aggregation--monitoring-pipeline)
5. [Parallel Execution Engine](#5-parallel-execution-engine)
6. [Deployment Architecture](#6-deployment-architecture)

---

## 1. High-Level System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         VS Code Extension                                │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                    SuperRoo Orchestrator                           │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐  │  │
│  │  │ PM Agent │ │Coder Agent│ │Debugger  │ │ Tester   │ │Safety  │  │  │
│  │  │          │ │          │ │Agent     │ │ Agent    │ │Manager │  │  │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └────────┘  │  │
│  │                                                                     │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────────┐  │  │
│  │  │ Healing  │ │ ML Engine│ │ TaskQueue│ │ Product Memory       │  │  │
│  │  │ Module   │ │(Learners)│ │          │ │ (Features, Bugs)     │  │  │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────────────────┘  │  │
│  │                                                                     │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────────┐  │  │
│  │  │ CPU Guard│ │ Parallel │ │ Crawler  │ │ LogAggregator        │  │  │
│  │  │          │ │Executor  │ │ Agent    │ │ (buffered JSONL)     │  │  │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         Cloud IDE (mini-ide)                             │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Web Terminal │ File Browser │ Agent Runtime │ Sandbox Runner    │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         Cloud API (api.js)                               │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │
│  │ Telegram │ │ Auth     │ │Monitoring│ │ Healing  │ │ Savepoint    │  │
│  │ Bot      │ │ (JWT/OTP)│ │ Routes   │ │ Metrics  │ │ Service      │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         Cloud Workers                                    │
│  ┌──────────────────┐ ┌──────────────────┐ ┌────────────────────────┐  │
│  │ Auto-Deployer    │ │ Debug Job Runner │ │ Sandbox Runner        │  │
│  │ (watches GitHub) │ │ (runs debug jobs)│ │ (isolated containers) │  │
│  └──────────────────┘ └──────────────────┘ └────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         External Services                                │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │
│  │ GitHub   │ │ Supabase │ │ Telegram │ │DigitalOcean│ │ n8n          │  │
│  │ (CI/CD)  │ │ (DB/Auth)│ │ (Bot API)│ │ (VPS)     │ │ (Workflows)  │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Layer                 | Components                               | Purpose                               |
| --------------------- | ---------------------------------------- | ------------------------------------- |
| **VS Code Extension** | Orchestrator, Agents, Healing, ML, Queue | Core automation engine                |
| **Cloud IDE**         | Mini-IDE, Sandbox                        | Browser-based development environment |
| **Cloud API**         | Telegram Bot, Auth, Monitoring           | REST API for external access          |
| **Cloud Workers**     | Auto-Deployer, Debug Runner              | Background task processing            |
| **External**          | GitHub, Supabase, Telegram, VPS          | Third-party integrations              |

---

## 2. Healing Module Flow

```mermaid
flowchart TD
    %% Sources
    SMOKE["Smoke Test Failure"]
    MONITOR["Health Monitor Alert"]
    AGENT["Agent Error Report"]
    USER["Manual Report"]

    %% Healing Bus
    SMOKE --> BUS["HealingBus.reportIncident()"]
    MONITOR --> BUS
    AGENT --> BUS
    USER --> BUS

    BUS --> DEDUP{"Deduplicate\n(fingerprint match)"}
    DEDUP -->|New| NEW["Status: new"]
    DEDUP -->|Existing| UPDATE["Update record"]

    NEW --> CLASSIFY["RootCauseClassifier\nclassifyRootCause()"]
    CLASSIFY --> CAT{"Category?"}

    CAT -->|ENV_MISSING| ENV["Check env vars"]
    CAT -->|BROKEN_ROUTE| ROUTE["Check route handlers"]
    CAT -->|DB_SCHEMA_MISMATCH| DB["Check migrations"]
    CAT -->|DEPLOY_DRIFT| DRIFT["Check version mismatch"]
    CAT -->|SECURITY_RISK| SEC["Flag for human review"]
    CAT -->|UNKNOWN| UNK["Fallback: general inspect"]

    ENV --> PLAN["RepairPlanBuilder\nbuildRepairPlan()"]
    ROUTE --> PLAN
    DB --> PLAN
    DRIFT --> PLAN
    SEC --> PLAN
    UNK --> PLAN

    PLAN --> APPROVAL{"Approval\nRequired?"}

    APPROVAL -->|Yes| HUMAN["Status: needs_human_approval"]
    APPROVAL -->|No| QUEUE["Status: queued_for_fix"]

    HUMAN --> WAIT["Wait for human\nreview & approval"]
    WAIT -->|Approved| QUEUE
    WAIT -->|Rejected| CLOSE["Close incident"]

    QUEUE --> FIX["Status: fixing\nAgent executes fix"]
    FIX --> RESULT{"Fix\nSuccessful?"}

    RESULT -->|Yes| DEPLOYED["Status: deployed"]
    RESULT -->|No| RETRY{"Retries <\nmaxRetries?"}

    RETRY -->|Yes| QUEUE
    RETRY -->|No| ESCALATE{"Escalation\nPolicy"}

    ESCALATE -->|warn| WARN["Log warning"]
    ESCALATE -->|notify| NOTIFY["Notify human"]
    ESCALATE -->|block| BLOCKED["Status: blocked"]
    ESCALATE -->|circuit_breaker| CB["Open circuit\nbreaker"]

    DEPLOYED --> VERIFY["Status: verifying\nRun verification tests"]
    VERIFY --> PASS{"Tests\nPass?"}

    PASS -->|Yes| VERIFIED["Status: verified\n✅ Fixed"]
    PASS -->|No| REOPENED["Status: reopened\n↻ Retry"]

    REOPENED --> RETRY

    %% Metrics
    VERIFIED --> METRICS["HealingMetrics\nrecordOutcome(success)"]
    BLOCKED --> METRICS_FAIL["HealingMetrics\nrecordOutcome(failure)"]
    CB --> METRICS_FAIL

    %% Styling
    classDef source fill:#e1f5fe,stroke:#0288d1
    classDef process fill:#f3e5f5,stroke:#7b1fa2
    classDef decision fill:#fff3e0,stroke:#f57c00
    classDef terminal fill:#e8f5e9,stroke:#388e3c
    classDef failure fill:#fce4ec,stroke:#d32f2f

    class SMOKE,MONITOR,AGENT,USER source
    class BUS,CLASSIFY,PLAN source
    class CAT,APPROVAL,RESULT,RETRY,ESCALATE,PASS decision
    class VERIFIED,CLOSE terminal
    class BLOCKED,CB failure
```

### Incident State Machine

```
                    ┌─────────────────────────────────────┐
                    │              new                     │
                    └──────────┬──────────────────────────┘
                               │
                               ▼
                    ┌─────────────────────────────────────┐
                    │         investigating                │
                    └──────────┬──────────────────────────┘
                               │
                               ▼
                    ┌─────────────────────────────────────┐
                    │        queued_for_fix                │
                    └──────┬──────────┬───────────────────┘
                           │          │
                           ▼          ▼
              ┌──────────────────┐  ┌──────────────────────────┐
              │     fixing       │  │  needs_human_approval    │
              └──────┬───────────┘  └──────────────────────────┘
                     │
                     ▼
              ┌──────────────────┐
              │    fix_ready     │
              └──────┬───────────┘
                     │
                     ▼
              ┌──────────────────┐
              │    deployed      │
              └──────┬───────────┘
                     │
                     ▼
              ┌──────────────────┐
              │   verifying      │
              └──────┬───────────┘
                     │
              ┌──────┴──────┐
              ▼             ▼
      ┌─────────────┐  ┌──────────┐
      │  verified   │  │ reopened │
      │  ✅ Done    │  │  ↻ Retry │
      └─────────────┘  └──────────┘
```

---

## 3. ML Engine Component Diagram

```mermaid
flowchart LR
    %% Top level
    subgraph API["ML Engine Public API"]
        NN["NeuralNetwork"]
        T["Tensor"]
    end

    subgraph LAYERS["Layer Types"]
        DENSE["DenseLayer\n(weights + biases)"]
        RELU["ReLULayer\n(max(0,x))"]
        SIGMOID["SigmoidLayer\n(1/(1+e^-x))"]
        TANH["TanhLayer\n(tanh(x))"]
        SOFTMAX["SoftmaxLayer\n(stable softmax)"]
        DROPOUT["DropoutLayer\n(training mask)"]
        BN["BatchNormLayer\n(gamma, beta)"]
        CONV["Conv2D\n(im2col)"]
        POOL["MaxPool2D\n(max pooling)"]
        FLAT["Flatten\n(reshape)"]
    end

    subgraph OPTIMIZERS["Optimizers"]
        ADAM["AdamOptimizer\n(beta1, beta2, eps)"]
        SGD["SGDOptimizer\n(momentum)"]
        LRS["LR Schedulers\nStepDecay | ExpDecay | ReduceLROnPlateau"]
    end

    subgraph LOSS["Loss Functions"]
        MSE["MSELoss\n(regression)"]
        XENT["CrossEntropyLoss\n(classification)"]
        BCE["BCELoss\n(binary)"]
        HUBER["HuberLoss\n(robust regression)"]
        HINGE["HingeLoss\n(SVM-style)"]
    end

    subgraph PERSIST["Persistence"]
        CKPT["ModelCheckpoint\n(atomic JSON writes)"]
        MP["ModelPersistence\n(encoder + heads)"]
    end

    subgraph METRICS["Evaluation Metrics"]
        CLASS["ClassificationMetrics\n(acc, prec, recall, F1)"]
        REGR["RegressionMetrics\n(MAE, RMSE, R²)"]
        AOT["ActionOutcomeTracker\n(help rate, avg delta)"]
    end

    %% Connections
    NN --> LAYERS
    NN --> OPTIMIZERS
    NN --> LOSS
    NN --> PERSIST
    NN --> METRICS
    T --> LAYERS
    T --> LOSS
    T --> METRICS
    ADAM --> LRS
    SGD --> LRS

    %% Learning modules
    subgraph LEARNERS["Learners (ML Learning)"]
        CL["CodeLearner"]
        DL["DebugLearner"]
        TL["TestLearner"]
    end

    NN --> LEARNERS
    PERSIST --> LEARNERS

    %% Styling
    classDef api fill:#e3f2fd,stroke:#1565c0
    classDef layer fill:#f3e5f5,stroke:#7b1fa2
    classDef opt fill:#e8f5e9,stroke:#2e7d32
    classDef loss fill:#fff3e0,stroke:#e65100
    classDef persist fill:#fce4ec,stroke:#c62828
    classDef metrics fill:#f3e5f5,stroke:#6a1b9a
    classDef learner fill:#e0f7fa,stroke:#00695c

    class NN,T api
    class DENSE,RELU,SIGMOID,TANH,SOFTMAX,DROPOUT,BN,CONV,POOL,FLAT layer
    class ADAM,SGD,LRS opt
    class MSE,XENT,BCE,HUBER,HINGE loss
    class CKPT,MP persist
    class CLASS,REGR,AOT metrics
    class CL,DL,TL learner
```

### Layer Architecture (Forward Pass)

```
Input Tensor [N, inFeatures]
        │
        ▼
┌───────────────────┐
│   DenseLayer      │  W: [inFeatures × outFeatures], b: [1 × outFeatures]
│   out = input·W+b │
└────────┬──────────┘
         │ [N, outFeatures]
         ▼
┌───────────────────┐
│  BatchNormLayer   │  γ, β learnable params
│  γ·(x-μ)/√(σ²+ε)+β│
└────────┬──────────┘
         │ [N, outFeatures]
         ▼
┌───────────────────┐
│   ReLULayer       │  max(0, x)
└────────┬──────────┘
         │ [N, outFeatures]
         ▼
┌───────────────────┐
│  DropoutLayer     │  (training only) random mask × 1/(1-rate)
└────────┬──────────┘
         │ [N, outFeatures]
         ▼
    (repeat for each hidden layer)
         │
         ▼
┌───────────────────┐
│  SoftmaxLayer     │  exp(x_i)/Σexp(x_j)
└────────┬──────────┘
         │ [N, outFeatures]
         ▼
   Output Tensor
```

### ConvNet Architecture (Image Classification)

```
Input [N, C×H×W]  e.g., [N, 3×32×32]
        │
        ▼
┌───────────────────────┐
│  Conv2D(3→16, 3×3)   │  im2col → matmul
│  ReLU                 │
│  MaxPool2D(2×2, S=2)  │  → [N, 16×16×16]
└──────────┬────────────┘
           │
           ▼
┌───────────────────────┐
│  Conv2D(16→32, 3×3)  │
│  ReLU                 │
│  MaxPool2D(2×2, S=2)  │  → [N, 32×8×8]
└──────────┬────────────┘
           │
           ▼
┌───────────────────────┐
│  Flatten              │  → [N, 2048]
│  Dense(2048→64)       │
│  ReLU                 │
│  Dense(64→10)         │
│  Softmax              │  → [N, 10]
└───────────────────────┘
```

---

## 4. Log Aggregation & Monitoring Pipeline

```mermaid
flowchart LR
    %% Sources
    EXT["VS Code Extension"]
    API["Cloud API"]
    WKR["Cloud Worker"]
    DASH["Dashboard"]
    HEAL["Healing Module"]
    ML["ML Engine"]

    %% LogAggregator
    EXT -->|"log(source, level, msg)"| LA["LogAggregator"]
    API --> LA
    WKR --> LA
    DASH --> LA
    HEAL --> LA
    ML --> LA

    subgraph BUFFER["In-Memory Buffer"]
        BUF["Buffer<LogEntry>\n(maxBufferSize: 100)"]
    end

    LA --> BUF

    subgraph FLUSH["Periodic Flush (every 5s)"]
        JSONL["JSONL File\nlogs/superroo-YYYY-MM-DD.jsonl"]
    end

    BUF -->|flush()| JSONL

    subgraph RETENTION["Retention Policy"]
        CLEANUP["Cleanup old files\n(retentionDays: 30)"]
    end

    JSONL --> CLEANUP

    %% Query
    subgraph QUERY["Query API"]
        Q["query(options)\nfilter: source, level, time, search"]
    end

    LA --> Q
    JSONL --> Q

    %% Monitoring Dashboard
    subgraph DASHBOARD["Cloud Dashboard"]
        MON["/api/monitoring/logs"]
        STATS["/api/monitoring/stats"]
        HEALTH["/api/monitoring/health-timeline"]
    end

    Q --> MON
    Q --> STATS
    Q --> HEALTH

    %% Styling
    classDef source fill:#e1f5fe,stroke:#0288d1
    classDef process fill:#f3e5f5,stroke:#7b1fa2
    classDef storage fill:#e8f5e9,stroke:#388e3c
    classDef query fill:#fff3e0,stroke:#f57c00
    classDef dash fill:#fce4ec,stroke:#c62828

    class EXT,API,WKR,DASH,HEAL,ML source
    class LA,BUF,FLUSH process
    class JSONL,CLEANUP storage
    class Q query
    class MON,STATS,HEALTH dash
```

### Log Entry Schema

```typescript
interface LogEntry {
	id: string // UUID v4
	timestamp: number // Unix ms
	source: LogSource // "extension" | "cloud-api" | "cloud-worker" | "dashboard" | "healing" | "ml" | "agent" | "system"
	level: LogLevel // "debug" | "info" | "warn" | "error" | "success"
	message: string // Human-readable
	metadata?: Record<string, unknown> // Structured data
}
```

### Query Examples

```typescript
// Get recent errors from healing module
const errors = await aggregator.query({
	source: "healing",
	level: "error",
	limit: 50,
})

// Get all logs in a time range
const range = await aggregator.query({
	from: Date.now() - 3600000, // Last hour
	to: Date.now(),
	search: "circuit breaker",
})

// Paginate through results
const page1 = await aggregator.query({ limit: 100, offset: 0 })
const page2 = await aggregator.query({ limit: 100, offset: 100 })
```

---

## 5. Parallel Execution Engine

```mermaid
flowchart TD
    %% Entry
    TASK["Task Submission"]

    TASK --> PE["ParallelExecutor"]

    subgraph EXEC["Parallel Execution"]
        direction LR
        A1["Agent 1\n(Coder)"]
        A2["Agent 2\n(Debugger)"]
        A3["Agent 3\n(Tester)"]
        A4["Agent 4\n(Deploy Checker)"]
    end

    PE --> EXEC

    subgraph BUS["AgentBus"]
        AB["Message Routing\n& Coordination"]
    end

    A1 <--> AB
    A2 <--> AB
    A3 <--> AB
    A4 <--> AB

    subgraph HEALING_PIPELINE["Parallel Healing Pipeline"]
        HP1["Incident 1\nFix"]
        HP2["Incident 2\nFix"]
        HP3["Incident 3\nFix"]
    end

    AB --> HEALING_PIPELINE

    subgraph ML_TRAIN["Parallel ML Training"]
        MT1["CodeLearner\nTrain"]
        MT2["DebugLearner\nTrain"]
        MT3["TestLearner\nTrain"]
    end

    AB --> ML_TRAIN

    subgraph GUARD["CPU Guard"]
        CG["AgentLoopGuard\n(maxConcurrent)"]
        AC["AutonomousController\n(throttle)"]
    end

    PE --> GUARD
    EXEC --> GUARD

    GUARD --> RESULT["Aggregated Results"]

    %% Styling
    classDef input fill:#e1f5fe,stroke:#0288d1
    classDef exec fill:#f3e5f5,stroke:#7b1fa2
    classDef bus fill:#e8f5e9,stroke:#388e3c
    classDef guard fill:#fff3e0,stroke:#f57c00
    classDef output fill:#fce4ec,stroke:#c62828

    class TASK input
    class PE,EXEC exec
    class AB,HEALING_PIPELINE,ML_TRAIN bus
    class CG,AC guard
    class RESULT output
```

---

## 6. Deployment Architecture

```mermaid
flowchart TD
    %% GitHub
    GH["GitHub Repository\njpgyap-sudo/superroo2"]

    %% CI
    CI["GitHub Actions\nCI Pipeline"]
    GH --> CI
    CI -->|"pnpm install, check-types, bundle"| BUILD["Build Artifacts"]

    %% VPS
    subgraph VPS["DigitalOcean VPS (100.64.175.88)"]
        DAEMON["SuperRoo Daemon\n(systemd service)"]
        API["Cloud API\n(api.js, port 8787)"]
        DASHBOARD["Cloud Dashboard\n(Next.js)"]
        WORKER["Cloud Worker\n(background jobs)"]
        TELEGRAM["Telegram Bot\n(bridge)"]
        N8N["n8n\n(workflow automation)"]
        MINIIDE["Mini IDE\n(sandboxed)"]
    end

    BUILD -->|"scp via Tailscale SSH"| DAEMON
    BUILD -->|"scp via Tailscale SSH"| API
    BUILD -->|"scp via Tailscale SSH"| DASHBOARD
    BUILD -->|"scp via Tailscale SSH"| WORKER

    %% External
    TG["Telegram API"]
    SUPABASE["Supabase\n(PostgreSQL + Auth)"]

    TELEGRAM <--> TG
    API <--> SUPABASE
    DAEMON --> API
    DAEMON --> WORKER
    API --> DASHBOARD
    API --> MINIIDE

    %% Auto-deployer
    WATCHER["Auto-Deployer Worker\n(watches GitHub)"]
    GH -->|"poll for new commits"| WATCHER
    WATCHER -->|"auto-deploy"| DAEMON

    %% Styling
    classDef external fill:#e1f5fe,stroke:#0288d1
    classDef ci fill:#f3e5f5,stroke:#7b1fa2
    classDef vps fill:#e8f5e9,stroke:#388e3c
    classDef deploy fill:#fff3e0,stroke:#f57c00

    class GH,TG,SUPABASE external
    class CI,BUILD ci
    class DAEMON,API,DASHBOARD,WORKER,TELEGRAM,N8N,MINIIDE vps
    class WATCHER deploy
```

---

## See Also

- [`ML_ENGINE_API.md`](ML_ENGINE_API.md) — ML engine API reference
- [`HEALING_MODULE_GUIDE.md`](HEALING_MODULE_GUIDE.md) — Healing module usage guide
- [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md) — Common issues and solutions
- [`DEPLOYMENT_GUIDE.md`](DEPLOYMENT_GUIDE.md) — Deployment instructions
- [`docs/resources/working-tree.md`](../resources/working-tree.md) — Product architecture working tree
