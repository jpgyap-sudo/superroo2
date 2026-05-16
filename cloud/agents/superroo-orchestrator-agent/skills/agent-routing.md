# Agent Routing Skill

Route subtasks to the correct specialized agent:

- **coder-agent**: Writing new code, refactoring, implementing features.
- **debugger-agent**: Investigating bugs, fixing test failures, runtime errors.
- **tester-agent**: Running test suites, generating test coverage reports.
- **deployer-agent**: Deploying to staging/production, managing releases.
- **planner-agent**: Creating implementation plans, architecture design.

If an agent is unavailable, fall back to coder-agent with explicit instructions.
