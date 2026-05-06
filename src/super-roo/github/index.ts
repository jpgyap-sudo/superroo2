/**
 * SuperRoo — GitHub Dashboard Service
 *
 * Backend service that aggregates real data from:
 *   - CommitDeployLog (commits, deploys)
 *   - HealingBus (incidents, health)
 *   - Git utilities (branch, working tree)
 *   - Agent system (current tasks, activity)
 *
 * This replaces the mock data from the upgrade package with live data
 * from the SuperRoo runtime.
 */

export { GitHubDashboardService } from "./GitHubDashboardService"
export type { GitHubDashboardServiceConfig } from "./GitHubDashboardService"
