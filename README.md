<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=SuperRoo.superroo"><img src="https://img.shields.io/badge/VS_Code_Marketplace-007ACC?style=flat&logo=visualstudiocode&logoColor=white" alt="VS Code Marketplace"></a>
  <a href="https://x.com/superroo"><img src="https://img.shields.io/badge/superroo-000000?style=flat&logo=x&logoColor=white" alt="X"></a>
  <a href="https://youtube.com/@superrooyt?feature=shared"><img src="https://img.shields.io/badge/YouTube-FF0000?style=flat&logo=youtube&logoColor=white" alt="YouTube"></a>
  <a href="https://discord.gg/superroo"><img src="https://img.shields.io/badge/Join%20Discord-5865F2?style=flat&logo=discord&logoColor=white" alt="Join Discord"></a>
  <a href="https://www.reddit.com/r/SuperRoo/"><img src="https://img.shields.io/badge/Join%20r%2FSuperRoo-FF4500?style=flat&logo=reddit&logoColor=white" alt="Join r/SuperRoo"></a>
</p>

# SuperRoo

> Autonomous AI engineering platform with a Central Brain, Telegram control plane, cloud dashboard, learning layer, monitoring, and self-healing.

SuperRoo is not just an editor assistant. It is a full-stack AI engineering system that plans, codes, tests, deploys, observes, learns, and repairs with an auditable multi-agent workflow. The product combines a VS Code extension, cloud dashboard, Telegram operator interface, persistent Central Brain memory, deployment orchestration, and self-healing incident pipelines.

## What Makes SuperRoo Different

| Layer                      | What it does                                                                                                                                 |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Central Brain**          | Stores cross-project lessons, task history, model decisions, and reusable engineering knowledge so agents stop repeating mistakes.           |
| **Learning Layer**         | Captures lessons from commits and task completions, indexes them locally and centrally, and injects relevant memory before new work starts.  |
| **Cloud Dashboard**        | Gives operators live views for agents, jobs, logs, monitoring, healing, deployments, model routing, product memory, and workflow compliance. |
| **Telegram Control Plane** | Lets you command, approve, inspect, and improve the system from Telegram instead of staying inside the IDE.                                  |
| **Self-Healing Engine**    | Detects incidents, classifies root causes, builds repair plans, tracks repair attempts, verifies outcomes, and escalates repeated failures.  |
| **Unified Deploy System**  | Queues builds and deployments through a single orchestrator with health checks, rollback paths, and commit/deploy audit records.             |

## Core Capabilities

- Multi-agent orchestration for coding, debugging, testing, product management, deployment, and repair.
- Persistent product memory for features, bugs, updates, commits, deployments, and active Codex tasks.
- Monitoring APIs and dashboards for logs, health timelines, service status, RAM/CPU signals, and healing proof metrics.
- Self-healing telemetry including success rates, repair execution tracking, escalation counts, repeated-failure detection, and recent incident trends.
- Model routing across provider-specific strengths, with DeepSeek for implementation, Codex for review, and Ollama for local embeddings/memory.
- Safety controls for approval gates, autonomy levels, command restrictions, rollback, and deployment hygiene.

## Operator Surfaces

- **VS Code extension** - work where the code lives.
- **Cloud dashboard** - inspect system state, jobs, logs, healing, deployments, memory, and compliance.
- **Telegram bot** - operate the system remotely with alerting and approval workflows.
- **Central Brain / learning CLI** - query and store lessons across projects with local-first fallback.

## Current Focus Areas

SuperRoo already has strong primitives for monitoring and self-healing. The next proof milestones are:

1. Publish live success-rate and repair-attempt metrics from production runs, not only tests.
2. Expand monitoring from dashboards into alert rules and notification routing.
3. Keep README/docs aligned with the actual platform architecture instead of generic extension copy.

---

## Local Setup & Development

1. **Clone** the repo:

```sh
git clone https://github.com/SuperRooInc/SuperRoo.git
```

2. **Install dependencies**:

```sh
pnpm install
```

3. **Run the extension**:

There are several ways to run the SuperRoo extension:

### Development Mode (F5)

For active development, use VSCode's built-in debugging:

Press `F5` (or go to **Run** → **Start Debugging**) in VSCode. This will open a new VSCode window with the SuperRoo extension running.

- Changes to the webview will appear immediately.
- Changes to the core extension will also hot reload automatically.

### Automated VSIX Installation

To build and install the extension as a VSIX package directly into VSCode:

```sh
pnpm install:vsix [-y] [--editor=<command>]
```

This command will:

- Ask which editor command to use (code/cursor/code-insiders) - defaults to 'code'
- Uninstall any existing version of the extension.
- Build the latest VSIX package.
- Install the newly built VSIX.
- Prompt you to restart VS Code for changes to take effect.

Options:

- `-y`: Skip all confirmation prompts and use defaults
- `--editor=<command>`: Specify the editor command (e.g., `--editor=cursor` or `--editor=code-insiders`)

### Manual VSIX Installation

If you prefer to install the VSIX package manually:

1.  First, build the VSIX package:
    ```sh
    pnpm vsix
    ```
2.  A `.vsix` file will be generated in the `bin/` directory (e.g., `bin/superroo-<version>.vsix`).
3.  Install it manually using the VSCode CLI:
    ```sh
    code --install-extension bin/superroo-<version>.vsix
    ```

---

We use [changesets](https://github.com/changesets/changesets) for versioning and publishing. Check our `CHANGELOG.md` for release notes.

---

## Disclaimer

**Please note** that SuperRoo, Inc does **not** make any representations or warranties regarding any code, models, or other tools provided or made available in connection with SuperRoo, any associated third-party tools, or any resulting outputs. You assume **all risks** associated with the use of any such tools or outputs; such tools are provided on an **"AS IS"** and **"AS AVAILABLE"** basis. Such risks may include, without limitation, intellectual property infringement, cyber vulnerabilities or attacks, bias, inaccuracies, errors, defects, viruses, downtime, property loss or damage, and/or personal injury. You are solely responsible for your use of any such tools or outputs (including, without limitation, the legality, appropriateness, and results thereof).

---

## Contributing

We love community contributions! Get started by reading our [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

[Apache 2.0 © 2025 SuperRoo, Inc.](./LICENSE)

---

**Enjoy SuperRoo!** Whether you keep it on a short leash or let it roam autonomously, we can’t wait to see what you build. If you have questions or feature ideas, drop by our [Reddit community](https://www.reddit.com/r/SuperRoo/) or [Discord](https://discord.gg/superroo). Happy coding!
