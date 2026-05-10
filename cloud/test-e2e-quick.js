const t = require("./api/telegramBot.js")
const n = require("./api/telegramNotifier.js")

var tests = [
	["consultant", "should I use microservices"],
	["consultant", "analyze this architecture"],
	["consultant", "compare React vs Vue"],
	["consultant", "what are the pros and cons"],
	["consultant", "recommend a database"],
	["consultant", "evaluate this approach"],
	["consultant", "explain how Kubernetes works"],
	["consultant", "tell me about machine learning"],
	["consultant", "upgrade skill on cloud"],
	["consultant", "deep dive into algorithms"],
	["debugger", "fix this bug"],
	["debugger", "debug this error"],
	["deployer", "deploy to production"],
	["tester", "write tests"],
	["ask", "hello how are you"],
]

var passed = 0
var failed = 0
tests.forEach(function (test) {
	var expected = test[0]
	var input = test[1]
	var result = t.detectIntent(input)
	if (result === expected) {
		passed++
		console.log('PASS: detectIntent("' + input + '") => ' + result)
	} else {
		failed++
		console.log('FAIL: detectIntent("' + input + '") => ' + result + " (expected " + expected + ")")
	}
})

console.log("")
console.log("Results: " + passed + " passed, " + failed + " failed out of " + tests.length + " tests")
console.log("")
console.log("=== Module Exports Check ===")
console.log("handleConsultant:", typeof t.handleConsultant)
console.log("detectIntent:", typeof t.detectIntent)
console.log("sendMessage:", typeof t.sendMessage)
console.log("handleUpdate:", typeof t.handleUpdate)
console.log("handleNaturalLanguageInstruction:", typeof t.handleNaturalLanguageInstruction)

console.log("")
console.log("=== New Bot Callback Handlers ===")
console.log("handlePreviewPlan:", typeof t.handlePreviewPlan)
console.log("handleApprovePlan:", typeof t.handleApprovePlan)
console.log("handleViewDiff:", typeof t.handleViewDiff)
console.log("handleDeployStaging:", typeof t.handleDeployStaging)
console.log("handleDeployProduction:", typeof t.handleDeployProduction)
console.log("handleRollbackCallback:", typeof t.handleRollbackCallback)

console.log("")
console.log("=== Notifier New Functions ===")
console.log("sendPlanPreview:", typeof n.sendPlanPreview)
console.log("sendSavepointCreated:", typeof n.sendSavepointCreated)
console.log("sendReviewReady:", typeof n.sendReviewReady)
console.log("sendDeploymentHealth:", typeof n.sendDeploymentHealth)
console.log("sendRollbackAvailable:", typeof n.sendRollbackAvailable)
console.log("setGroupRouting:", typeof n.setGroupRouting)
console.log("resolveChatId:", typeof n.resolveChatId)

console.log("")
console.log("=== Notifier Existing Functions ===")
console.log("sendTaskStarted:", typeof n.sendTaskStarted)
console.log("sendTaskComplete:", typeof n.sendTaskComplete)
console.log("sendTaskFailed:", typeof n.sendTaskFailed)
console.log("sendApprovalRequest:", typeof n.sendApprovalRequest)
console.log("sendDeployNotification:", typeof n.sendDeployNotification)
console.log("sendDebugComplete:", typeof n.sendDebugComplete)
console.log("sendNotification:", typeof n.sendNotification)
console.log("handleNotificationCallback:", typeof n.handleNotificationCallback)
console.log("getApprovalStatus:", typeof n.getApprovalStatus)
console.log("clearNotifications:", typeof n.clearNotifications)
