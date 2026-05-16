import { SuperRooCore } from "../SuperRooCore"
import { logHeader, logStep, logWarn } from "../utils/logger"

interface AutonomousOptions {
	project?: string
	hours?: string
	autoApprove?: boolean
	deploy?: boolean
}

export async function runAutonomousCommand(options: AutonomousOptions): Promise<void> {
	logHeader("SuperRoo Autonomous Mode")

	const hours = Number(options.hours || "1")
	const allowDeploy = Boolean(options.deploy) && process.env.SUPERROO_ALLOW_AUTO_DEPLOY === "true"

	const core = new SuperRooCore({
		projectPath: options.project,
		autoApprove: Boolean(options.autoApprove),
		allowDeploy,
	})

	await core.verifyProject()

	const gitStatus = await core.gitStatus()
	if (gitStatus && process.env.SUPERROO_REQUIRE_CLEAN_GIT === "true") {
		logWarn("Project has uncommitted changes. Creating checkpoint commit before autonomous run.")
		await core.createCheckpointCommit("chore: checkpoint before superroo autonomous run")
	}

	logStep(`Runtime budget: ${hours} hour(s)`)
	logStep("Phase 1: install dependencies")
	await core.runInstall()

	logStep("Phase 2: build project")
	await core.runBuild()

	logStep("Phase 3: run tests")
	await core.runTests()

	logStep("Phase 4: agent loop placeholder")
	console.log(`
TODO: Connect your existing Roo/SuperRoo agents here:
- Product Manager Agent reads feature log
- Debugger Agent reads bug dashboard
- Coder Agent applies fixes
- Tester Agent runs tests
- Deploy Checker Agent verifies live site
`)

	if (process.env.SUPERROO_ALLOW_AUTO_COMMIT === "true") {
		await core.createCheckpointCommit("chore: superroo autonomous update")
	}

	if (allowDeploy) {
		logStep("Deploy is allowed. Run: superroo deploy")
	} else {
		logWarn("Auto deploy disabled. Set SUPERROO_ALLOW_AUTO_DEPLOY=true and pass deploy flag when ready.")
	}

	logHeader("Autonomous mode completed")
}
