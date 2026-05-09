/**
 * SuperRoo Cloud — Telegram Mini App Login
 *
 * This is a standalone login panel that runs inside Telegram's Mini App WebView.
 * It guides the user through a 6-step flow:
 *   1. Landing (welcome screen)
 *   2. Email entry
 *   3. Password entry
 *   4. Loading (API call)
 *   5. Success (linked)
 *   6. Error (retry)
 *
 * After successful login, it calls the SuperRoo Cloud API to link the
 * Telegram user's chat ID with their SuperRoo Cloud account.
 */

;(function () {
	"use strict"

	// ─── Configuration ────────────────────────────────────────────────

	/** Base URL of the SuperRoo Cloud API */
	var API_BASE = "/api"

	// ─── State ────────────────────────────────────────────────────────

	var state = {
		step: "landing",
		email: "",
		password: "",
		telegramUserId: null,
		chatId: null,
	}

	// ─── DOM References ───────────────────────────────────────────────

	var steps = {
		landing: document.getElementById("step-landing"),
		email: document.getElementById("step-email"),
		password: document.getElementById("step-password"),
		loading: document.getElementById("step-loading"),
		success: document.getElementById("step-success"),
		error: document.getElementById("step-error"),
	}

	var inputEmail = document.getElementById("input-email")
	var inputPassword = document.getElementById("input-password")
	var emailError = document.getElementById("email-error")
	var passwordError = document.getElementById("password-error")
	var errorMessage = document.getElementById("error-message")
	var successEmail = document.getElementById("success-email")

	// ─── URL Parameters ───────────────────────────────────────────────

	function getUrlParams() {
		var params = {}
		var query = window.location.search.substring(1)
		if (!query) return params
		var pairs = query.split("&")
		for (var i = 0; i < pairs.length; i++) {
			var pair = pairs[i].split("=")
			var key = decodeURIComponent(pair[0] || "")
			var value = decodeURIComponent(pair[1] || "")
			if (key) params[key] = value
		}
		return params
	}

	// ─── Step Navigation ──────────────────────────────────────────────

	function showStep(stepName) {
		// Hide all steps
		for (var key in steps) {
			if (steps[key]) {
				steps[key].style.display = "none"
			}
		}

		// Show the requested step
		if (steps[stepName]) {
			steps[stepName].style.display = "flex"
		}

		state.step = stepName

		// Focus input when switching to email/password steps
		if (stepName === "email" && inputEmail) {
			inputEmail.focus()
		}
		if (stepName === "password" && inputPassword) {
			inputPassword.focus()
		}
	}

	// ─── API Call ─────────────────────────────────────────────────────

	async function callApi(path, body) {
		var url = API_BASE + path
		var res = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		})
		var data = await res.json()
		if (!res.ok) {
			throw new Error(data.error || data.message || "Request failed with status " + res.status)
		}
		return data
	}

	// ─── Login Flow ───────────────────────────────────────────────────

	async function login() {
		showStep("loading")

		try {
			// Step 1: Login with email + password
			var loginResult = await callApi("/auth/login", {
				email: state.email,
				password: state.password,
			})

			if (!loginResult || !loginResult.token) {
				throw new Error("Login failed - no token received")
			}

			// Step 2: Link Telegram account
			var linkResult = await callApi("/auth/link-vscode", {
				email: state.email,
				device_id: "telegram:" + state.telegramUserId,
				device_name: "Telegram Chat " + state.chatId,
			})

			// Step 3: Create/refresh Telegram session in auth module
			var sessionResult = await callApi("/telegram/auth/login", {
				telegram_user_id: state.telegramUserId,
				telegram_chat_id: state.chatId,
				email: state.email,
			})

			// Show success
			successEmail.textContent = state.email
			showStep("success")

			// Notify Telegram that the Mini App is done
			try {
				if (window.Telegram && window.Telegram.WebApp) {
					window.Telegram.WebApp.close()
				}
			} catch (e) {
				// Silently ignore - not running inside Telegram
			}
		} catch (err) {
			console.error("[telegram-miniapp] Login error:", err.message)
			errorMessage.textContent = err.message || "Could not connect to SuperRoo Cloud. Please try again."
			showStep("error")
		}
	}

	// ─── Validation ───────────────────────────────────────────────────

	function validateEmail(email) {
		return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
	}

	// ─── Event Handlers ───────────────────────────────────────────────

	function init() {
		// Parse URL parameters
		var params = getUrlParams()
		state.telegramUserId = params.telegram_id || null
		state.chatId = params.chat_id || null

		console.log(
			"[telegram-miniapp] Initialized with chat_id=" + state.chatId + ", telegram_id=" + state.telegramUserId,
		)

		// ── Landing Step ──
		document.getElementById("btn-start").addEventListener("click", function () {
			showStep("email")
		})

		// ── Email Step ──
		document.getElementById("btn-email-next").addEventListener("click", function () {
			var email = inputEmail.value.trim()
			if (!email) {
				emailError.textContent = "Please enter your email address."
				emailError.style.display = "block"
				return
			}
			if (!validateEmail(email)) {
				emailError.textContent = "Please enter a valid email address."
				emailError.style.display = "block"
				return
			}
			emailError.style.display = "none"
			state.email = email
			showStep("password")
		})

		inputEmail.addEventListener("keydown", function (e) {
			if (e.key === "Enter") {
				document.getElementById("btn-email-next").click()
			}
		})

		document.getElementById("btn-email-back").addEventListener("click", function () {
			showStep("landing")
		})

		// ── Password Step ──
		document.getElementById("btn-login").addEventListener("click", function () {
			var password = inputPassword.value.trim()
			if (!password) {
				passwordError.textContent = "Please enter your password."
				passwordError.style.display = "block"
				return
			}
			if (password.length < 4) {
				passwordError.textContent = "Password must be at least 4 characters."
				passwordError.style.display = "block"
				return
			}
			passwordError.style.display = "none"
			state.password = password
			login()
		})

		inputPassword.addEventListener("keydown", function (e) {
			if (e.key === "Enter") {
				document.getElementById("btn-login").click()
			}
		})

		document.getElementById("btn-password-back").addEventListener("click", function () {
			showStep("email")
		})

		// ── Error Step ──
		document.getElementById("btn-retry").addEventListener("click", function () {
			showStep("email")
		})

		// ── Success Step ──
		document.getElementById("btn-close").addEventListener("click", function () {
			try {
				if (window.Telegram && window.Telegram.WebApp) {
					window.Telegram.WebApp.close()
				} else {
					window.close()
				}
			} catch (e) {
				window.close()
			}
		})

		// Show landing step initially
		showStep("landing")
	}

	// ─── Boot ─────────────────────────────────────────────────────────

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init)
	} else {
		init()
	}
})()
