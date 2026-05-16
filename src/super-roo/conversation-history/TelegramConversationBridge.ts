/**
 * Typed facade for the JavaScript Telegram conversation bridge used by the
 * plain-Node cloud runtime.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const bridge = require("./TelegramConversationBridge.js")

export const startConversation = bridge.startConversation as typeof bridge.startConversation
export const addMessage = bridge.addMessage as typeof bridge.addMessage
export const endConversation = bridge.endConversation as typeof bridge.endConversation
export const getActiveConversation = bridge.getActiveConversation as typeof bridge.getActiveConversation
export const getChatConversations = bridge.getChatConversations as typeof bridge.getChatConversations
export const getLatestAssistantMessage = bridge.getLatestAssistantMessage as typeof bridge.getLatestAssistantMessage
export const recordUserMessage = bridge.recordUserMessage as typeof bridge.recordUserMessage
export const recordBotResponse = bridge.recordBotResponse as typeof bridge.recordBotResponse
export const recordSystemEvent = bridge.recordSystemEvent as typeof bridge.recordSystemEvent
export const recordIssue = bridge.recordIssue as typeof bridge.recordIssue
export const recordError = bridge.recordError as typeof bridge.recordError
export const generateFrictionReport = bridge.generateFrictionReport as typeof bridge.generateFrictionReport
export const getQuickStats = bridge.getQuickStats as typeof bridge.getQuickStats
export const analyzeMessageForFriction = bridge.analyzeMessageForFriction as typeof bridge.analyzeMessageForFriction
export const runRuntimeAnalysis = bridge.runRuntimeAnalysis as typeof bridge.runRuntimeAnalysis
export const startRuntimeMonitor = bridge.startRuntimeMonitor as typeof bridge.startRuntimeMonitor
export const stopRuntimeMonitor = bridge.stopRuntimeMonitor as typeof bridge.stopRuntimeMonitor
