/**
 * Post-deployment verification test for Consultant agent and Telegram bot changes.
 * Run on VPS: node /opt/superroo2/cloud/test-consultant-deploy.js
 */
var bot = require('./api/telegramBot.js');
var tests = 0, passed = 0;

console.log("=== Consultant Agent Deployment Tests ===\n");

// Test 1: handleConsultant is exported
tests++;
if (typeof bot.handleConsultant === 'function') {
  console.log("PASS: handleConsultant is exported as function");
  passed++;
} else {
  console.log("FAIL: handleConsultant not exported");
}

// Test 2: detectIntent is exported
tests++;
if (typeof bot.detectIntent === 'function') {
  console.log("PASS: detectIntent is exported as function");
  passed++;
} else {
  console.log("FAIL: detectIntent not exported");
}

// Test 3: detectIntent returns 'consultant' for research questions
var consultantTests = [
  "should I use PostgreSQL or MongoDB?",
  "analyze the pros and cons of microservices",
  "research best practices for API design",
  "what is the best tech stack for a chat app?",
  "compare React vs Vue for enterprise",
  "tell me about kubernetes architecture",
  "evaluate the feasibility of this approach",
  "recommend a database for my project",
  "explain how authentication works",
  "upgrade my skill on debugging",
  "what is the best approach for this feature?",
  "is it good to use microservices?",
  "advise me on cloud architecture",
  "strategy for scaling my application",
  "deep dive into react performance",
];
consultantTests.forEach(function(q) {
  tests++;
  var result = bot.detectIntent(q);
  var intent = result.intent;
  if (intent === "consultant") {
    console.log("PASS: consultant detected for: " + q + " (score: " + result.score + ")");
    passed++;
  } else {
    console.log("FAIL: expected consultant got " + intent + " (score: " + result.score + ") for: " + q);
  }
});

// Test 4: detectIntent still returns 'coder' for coding tasks
var codingTests = [
  "fix the login bug",
  "implement a new feature",
  "code a REST API",
  "create a new endpoint",
  "refactor the database layer",
];
codingTests.forEach(function(q) {
  tests++;
  var result = bot.detectIntent(q);
  var intent = result.intent;
  if (intent === "coder" || intent === "debugger") {
    console.log("PASS: coding/debug intent for: " + q + " (score: " + result.score + ")");
    passed++;
  } else {
    console.log("FAIL: expected coder/debugger got " + intent + " (score: " + result.score + ") for: " + q);
  }
});

// Test 5: detectIntent returns 'debugger' for debugging
var debugTests = [
  "debug this error",
  "fix bug in payment module",
  "the app is crashing",
  "something is broken",
];
debugTests.forEach(function(q) {
  tests++;
  var result = bot.detectIntent(q);
  var intent = result.intent;
  if (intent === "debugger") {
    console.log("PASS: debugger detected for: " + q + " (score: " + result.score + ")");
    passed++;
  } else {
    console.log("FAIL: expected debugger got " + intent + " (score: " + result.score + ") for: " + q);
  }
});

// Test 6: detectIntent returns 'deployer' for deployment
var deployTests = [
  "deploy the latest build",
  "release version 2.0",
  "publish to production",
];
deployTests.forEach(function(q) {
  tests++;
  var result = bot.detectIntent(q);
  var intent = result.intent;
  if (intent === "deployer") {
    console.log("PASS: deployer detected for: " + q + " (score: " + result.score + ")");
    passed++;
  } else {
    console.log("FAIL: expected deployer got " + intent + " (score: " + result.score + ") for: " + q);
  }
});

// Test 7: detectIntent returns 'tester' for testing
var testTests = [
  "run tests for the API",
  "check test coverage",
  "run e2e tests",
];
testTests.forEach(function(q) {
  tests++;
  var result = bot.detectIntent(q);
  var intent = result.intent;
  if (intent === "tester") {
    console.log("PASS: tester detected for: " + q + " (score: " + result.score + ")");
    passed++;
  } else {
    console.log("FAIL: expected tester got " + intent + " (score: " + result.score + ") for: " + q);
  }
});

// Test 8: handleUpdate is exported
tests++;
if (typeof bot.handleUpdate === 'function') {
  console.log("PASS: handleUpdate is exported");
  passed++;
} else {
  console.log("FAIL: handleUpdate not exported");
}

// Test 9: Module exports include all expected functions
var expectedExports = [
  "sendMessage", "sendChatAction", "sendInlineKeyboard",
  "answerCallbackQuery", "editMessageText", "setWebhook",
  "getWebhookInfo", "deleteWebhook", "handleUpdate",
  "handleConsultant", "detectIntent",
  "generateTOTPSecret", "verifyTOTP", "generateOTPAuthURI",
];
expectedExports.forEach(function(name) {
  tests++;
  if (typeof bot[name] !== "undefined") {
    console.log("PASS: export '" + name + "' exists");
    passed++;
  } else {
    console.log("FAIL: export '" + name + "' missing");
  }
});

console.log("\n=== Results: " + passed + "/" + tests + " tests passed ===");
process.exit(passed === tests ? 0 : 1);
