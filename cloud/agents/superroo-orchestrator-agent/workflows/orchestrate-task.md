# Workflow: Orchestrate Multi-Step Task

1. Receive user request with goal and context.
2. Decompose into subtasks using task-decomposition skill.
3. For each subtask:
   a. Select the best agent using agent-routing skill.
   b. Submit subtask to the agent queue.
   c. Monitor progress and collect results.
4. Aggregate all results using result-aggregation skill.
5. Present final output to user.
6. Log completion to CommitDeployLog.
