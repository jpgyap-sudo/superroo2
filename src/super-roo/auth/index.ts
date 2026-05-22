/**
 * Super Roo — Auth System Abstraction (F7)
 *
 * Inspired by Mastra's 8 auth providers.
 * Provides a standard auth provider interface with multiple implementations.
 * SuperRoo2 has custom Telegram-based auth; this abstraction enables
 * Auth0, Clerk, Supabase Auth, and other standard providers.
 */

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export type AuthProviderType = "telegram" | "auth0" | "clerk" | "supabase" | "custom"

export interface AuthProviderConfig {
	type: AuthProviderType
	name: string
	clientId?: string
	clientSecret?: string
	issuerUrl?: string
	redirectUri?: string
	scopes?: string[]
	extraParams?: Record<string, string>
}

export interface AuthUser {
	id: string
	email?: string
	name?: string
	avatarUrl?: string
	provider: AuthProviderType
	providerUserId: string
	roles: string[]
	permissions: string[]
	metadata?: Record<string, unknown>
}

export interface AuthSession {
	id: string
	userId: string
	provider: AuthProviderType
	accessToken: string
	refreshToken?: string
	expiresAt: number
	createdAt: number
	ipAddress?: string
	userAgent?: string
}

export interface AuthResult<T = unknown> {
	success: boolean
	data?: T
	error?: string
	statusCode?: number
}

export interface LoginRequest {
	email?: string
	password?: string
	provider: AuthProviderType
	code?: string
	redirectUri?: string
}

export interface LoginResult {
	session: AuthSession
	user: AuthUser
	isNewUser: boolean
}

export interface VerifyResult {
	valid: boolean
	session?: AuthSession
	user?: AuthUser
}

export interface AuthProvider {
	readonly type: AuthProviderType
	readonly name: string

	initialize(config: AuthProviderConfig): Promise<AuthResult<void>>
	login(request: LoginRequest): Promise<AuthResult<LoginResult>>
	logout(sessionId: string): Promise<AuthResult<void>>
	verifySession(token: string): Promise<AuthResult<VerifyResult>>
	refreshSession(refreshToken: string): Promise<AuthResult<AuthSession>>
	getUser(userId: string): Promise<AuthResult<AuthUser>>
	updateUser(userId: string, updates: Partial<AuthUser>): Promise<AuthResult<AuthUser>>
	deleteUser(userId: string): Promise<AuthResult<void>>
}

// ──────────────────────────────────────────────────────────────────────────────
// Auth Manager
// ──────────────────────────────────────────────────────────────────────────────

export class AuthManager {
	private providers: Map<AuthProviderType, AuthProvider> = new Map()
	private sessions: Map<string, AuthSession> = new Map()
	private users: Map<string, AuthUser> = new Map()

	/**
	 * Register an auth provider.
	 */
	registerProvider(provider: AuthProvider): void {
		if (this.providers.has(provider.type)) {
			throw new Error(`Auth provider "${provider.type}" is already registered`)
		}
		this.providers.set(provider.type, provider)
	}

	/**
	 * Unregister an auth provider.
	 */
	unregisterProvider(type: AuthProviderType): void {
		this.providers.delete(type)
	}

	/**
	 * Get a registered provider by type.
	 */
	getProvider(type: AuthProviderType): AuthProvider | undefined {
		return this.providers.get(type)
	}

	/**
	 * List all registered providers.
	 */
	listProviders(): AuthProvider[] {
		return Array.from(this.providers.values())
	}

	/**
	 * Initialize all registered providers.
	 */
	async initializeAll(): Promise<AuthResult<void>> {
		const errors: string[] = []
		for (const provider of this.providers.values()) {
			try {
				await provider.initialize({ type: provider.type, name: provider.name })
			} catch (err) {
				errors.push(`[${provider.type}] ${err instanceof Error ? err.message : String(err)}`)
			}
		}
		if (errors.length > 0) {
			return { success: false, error: `Failed to initialize providers: ${errors.join("; ")}` }
		}
		return { success: true }
	}

	/**
	 * Login through a specific provider.
	 */
	async login(type: AuthProviderType, request: LoginRequest): Promise<AuthResult<LoginResult>> {
		const provider = this.providers.get(type)
		if (!provider) {
			return { success: false, error: `Auth provider "${type}" not found`, statusCode: 404 }
		}
		const result = await provider.login(request)
		if (result.success && result.data) {
			this.sessions.set(result.data.session.id, result.data.session)
			this.users.set(result.data.user.id, result.data.user)
		}
		return result
	}

	/**
	 * Logout and invalidate a session.
	 */
	async logout(sessionId: string): Promise<AuthResult<void>> {
		const session = this.sessions.get(sessionId)
		if (!session) {
			return { success: false, error: "Session not found", statusCode: 404 }
		}
		const provider = this.providers.get(session.provider)
		if (provider) {
			await provider.logout(sessionId)
		}
		this.sessions.delete(sessionId)
		return { success: true }
	}

	/**
	 * Verify a session token.
	 */
	async verifySession(token: string): Promise<AuthResult<VerifyResult>> {
		for (const provider of this.providers.values()) {
			try {
				const result = await provider.verifySession(token)
				if (result.success && result.data) {
					return result
				}
			} catch {
				continue
			}
		}
		return { success: false, error: "Session verification failed", statusCode: 401 }
	}

	/**
	 * Get a user by ID.
	 */
	async getUser(userId: string): Promise<AuthResult<AuthUser>> {
		const user = this.users.get(userId)
		if (user) {
			return { success: true, data: user }
		}
		// Try all providers
		for (const provider of this.providers.values()) {
			try {
				const result = await provider.getUser(userId)
				if (result.success && result.data) {
					this.users.set(result.data.id, result.data)
					return result
				}
			} catch {
				continue
			}
		}
		return { success: false, error: "User not found", statusCode: 404 }
	}

	/**
	 * Get session stats.
	 */
	getStats(): { totalProviders: number; activeSessions: number; totalUsers: number } {
		return {
			totalProviders: this.providers.size,
			activeSessions: this.sessions.size,
			totalUsers: this.users.size,
		}
	}
}

// ──────────────────────────────────────────────────────────────────────────────
// Singleton
// ──────────────────────────────────────────────────────────────────────────────

let _globalAuthManager: AuthManager | null = null

export function getAuthManager(): AuthManager {
	if (!_globalAuthManager) {
		_globalAuthManager = new AuthManager()
	}
	return _globalAuthManager
}
