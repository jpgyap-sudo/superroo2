---
name: supabase
description: 🔥 Supabase — Integrate Supabase (PostgreSQL, Auth, Realtime, Storage, Edge Functions) into SuperRoo apps
---

# Supabase Skill

## When To Use

Use this skill when the user asks to integrate Supabase services, use Supabase as a backend, set up authentication, work with PostgreSQL databases, use realtime subscriptions, store files, or deploy Edge Functions.

Also use this skill when tasks involve:
- Supabase PostgreSQL database (schema design, migrations, queries, Row Level Security)
- Supabase Auth (email/password, OAuth, magic link, phone auth, multi-tenancy)
- Supabase Realtime (broadcast, presence, Postgres Changes)
- Supabase Storage (buckets, file uploads, public/private access policies)
- Supabase Edge Functions (Deno-based serverless functions)
- Supabase Management API (project creation, SQL queries via API)
- Supabase Local Development (CLI, studio, migrations, seed data)
- Row Level Security (RLS) policies for multi-tenant apps
- Supabase Vector (pgvector for AI/embeddings)
- Supabase with Next.js, React, Vue, or other frameworks

## Core Concepts

### Supabase Architecture

Supabase is an open-source Firebase alternative built on:

- **PostgreSQL**: The core database with full SQL, extensions (pgvector, pg_graphql, pg_net)
- **GoTrue**: Self-hosted authentication service (Supabase Auth)
- **Realtime**: WebSocket-based realtime engine (broadcast, presence, Postgres CDC)
- **Storage**: S3-compatible file storage with PostgreSQL-backed metadata
- **Edge Functions**: Deno-based serverless functions running globally
- **pg_graphql**: GraphQL API directly from your PostgreSQL schema
- **autodoc**: Automatic API documentation from database schema

### Authentication Methods

| Method | Use Case | SDK/API |
|--------|----------|---------|
| **Email/Password** | Standard user accounts | `supabase.auth.signInWithPassword()` |
| **OAuth (Google, GitHub, etc.)** | Social login | `supabase.auth.signInWithOAuth()` |
| **Magic Link** | Passwordless email | `supabase.auth.signInWithOtp()` |
| **Phone Auth** | SMS verification | `supabase.auth.signInWithOtp()` |
| **Service Role Key** | Server-side admin operations | `service_role` key (server-only) |
| **Implicit Grant** | PKCE flow for SPAs | `supabase.auth.signInWithOAuth()` with PKCE |

### Client Libraries

```typescript
// Browser/Client (anon key)
import { createClient } from "@supabase/supabase-js"
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// Server (service role for admin operations)
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)
```

## Database Patterns

### Schema Design

```sql
-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users table (extends auth.users)
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);
```

### Migrations

Use Supabase CLI for migrations:

```bash
# Initialize
supabase init

# Create migration
supabase migration new create_profiles

# Apply migrations
supabase db push

# Generate types from database
supabase gen types typescript --local > database.types.ts
```

## Auth Patterns

### Next.js App Router Auth

```typescript
// app/auth/callback/route.ts
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get("code")

  if (code) {
    const supabase = createRouteHandlerClient({ cookies })
    await supabase.auth.exchangeCodeForSession(code)
  }

  return NextResponse.redirect(requestUrl.origin)
}
```

### Middleware for Protected Routes

```typescript
// middleware.ts
import { createMiddlewareClient } from "@supabase/auth-helpers-nextjs"
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

export async function middleware(req: NextRequest) {
  const res = NextResponse.next()
  const supabase = createMiddlewareClient({ req, res })
  const { data: { session } } = await supabase.auth.getSession()

  if (!session && req.nextUrl.pathname.startsWith("/dashboard")) {
    return NextResponse.redirect(new URL("/login", req.url))
  }

  return res
}
```

## Realtime Patterns

### Subscribe to Database Changes

```typescript
const channel = supabase
  .channel("table-db-changes")
  .on(
    "postgres_changes",
    { event: "INSERT", schema: "public", table: "tasks" },
    (payload) => {
      console.log("New task:", payload.new)
    }
  )
  .subscribe()
```

### Broadcast (Real-time Messages)

```typescript
// Send
const channel = supabase.channel("room-1")
channel.send({
  type: "broadcast",
  event: "cursor-pos",
  payload: { x: 100, y: 200 }
})

// Receive
channel.on("broadcast", { event: "cursor-pos" }, (payload) => {
  console.log("Cursor moved:", payload)
})
```

## Storage Patterns

```typescript
// Upload file
const { data, error } = await supabase.storage
  .from("avatars")
  .upload(`public/${userId}.jpg`, file)

// Get public URL
const { data: { publicUrl } } = supabase.storage
  .from("avatars")
  .getPublicUrl(`public/${userId}.jpg`)

// RLS for storage
// In Supabase dashboard: CREATE POLICY "Users can view own avatar"
// ON storage.objects FOR SELECT USING (auth.uid() = owner)
```

## Edge Functions

```typescript
// functions/hello-world/index.ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

serve(async (req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!
  )

  const { data } = await supabase.from("profiles").select("*")
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  })
})
```

## Supabase with Vercel

When deploying a Next.js app with Supabase to Vercel:

1. Set environment variables in Vercel dashboard:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (server-only)

2. Use `@supabase/ssr` package for server-side rendering support:
   ```bash
   npm install @supabase/ssr
   ```

3. Configure CORS in Supabase if making direct API calls from client

## Local Development

```bash
# Start Supabase stack locally
supabase start

# View local Studio
# http://localhost:54323

# Stop
supabase stop

# Reset database
supabase db reset

# Pull remote database
supabase db pull

# Push local changes to remote
supabase db push
```

## Security Best Practices

1. **Always enable RLS** on public tables — never rely on client-side filtering
2. **Use service_role key only on server** — never expose it to the client
3. **Validate user sessions** on every server request
4. **Use prepared statements** — Supabase client does this automatically
5. **Set up rate limiting** for auth endpoints to prevent brute force
6. **Use database functions** (PostgreSQL functions) for complex operations
7. **Enable MFA** for admin accounts
8. **Regularly audit RLS policies** with `supabase db diff`

## Common Pitfalls

1. **Forgetting RLS**: Tables without RLS are publicly accessible by default
2. **Exposing service_role key**: This key bypasses all RLS
3. **N+1 queries**: Use `select(*, related_table(*))` joins
4. **Missing indexes**: Add indexes on foreign keys and frequently queried columns
5. **Large realtime payloads**: Keep broadcast payloads small (< 1MB)
6. **Edge Function cold starts**: Use warm-up requests for latency-sensitive functions
