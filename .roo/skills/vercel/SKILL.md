---
name: vercel
description: ▲ Vercel — Deploy and integrate Vercel (Next.js, Edge Functions, Serverless, Analytics, ISR) into SuperRoo apps
---

# Vercel Skill

## When To Use

Use this skill when the user asks to deploy to Vercel, configure Vercel deployments, use Vercel Edge Functions, set up Incremental Static Regeneration (ISR), configure Vercel Analytics, manage environment variables, set up preview deployments, or integrate Vercel with other services.

Also use this skill when tasks involve:
- Deploying Next.js apps to Vercel
- Vercel Edge Functions (Edge Middleware, Edge Config, Edge Runtime)
- Vercel Serverless Functions (API routes, serverless Node.js)
- Incremental Static Regeneration (ISR) and On-Demand Revalidation
- Vercel Analytics (Web Analytics, Speed Insights)
- Vercel Environment Variables and Secrets
- Vercel Preview Deployments and Git Integration
- Vercel Domains, Redirects, Headers, and Rewrites
- Vercel Cron Jobs (cron triggers for serverless functions)
- Vercel KV (Redis), Blob (object storage), Postgres (serverless Postgres)
- Vercel with Supabase, Prisma, or other databases
- Monorepo deployment with Vercel (Turborepo, pnpm workspaces)
- Vercel CLI and API for programmatic deployments

## Core Concepts

### Vercel Platform Overview

Vercel is a cloud platform for frontend frameworks and static sites, built by the creators of Next.js:

- **Edge Network**: Global CDN with 100+ locations
- **Serverless Functions**: Node.js, Python, Go, Ruby, or custom runtime
- **Edge Functions**: Lightweight functions running at the edge (V8 isolates)
- **ISR**: Incremental Static Regeneration for hybrid pages
- **Preview Deployments**: Auto-generated preview URLs for every git push
- **Analytics**: Real-time web analytics and speed insights

### Deployment Configuration (vercel.json)

```json
{
  "version": 2,
  "framework": "nextjs",
  "buildCommand": "next build",
  "outputDirectory": ".next",
  "installCommand": "pnpm install",
  "regions": ["sin1", "iad1"],
  "env": {
    "NEXT_PUBLIC_API_URL": "@api_url"
  },
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "X-Content-Type-Options", "value": "nosniff" }
      ]
    }
  ],
  "redirects": [
    { "source": "/old-path", "destination": "/new-path", "permanent": true }
  ],
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api/$1" }
  ]
}
```

### Environment Variables

```bash
# Set in Vercel dashboard or via CLI
vercel env add NEXT_PUBLIC_SUPABASE_URL production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
vercel env pull .env.vercel  # Pull latest env vars
```

| Scope | Accessible In | Use Case |
|-------|--------------|----------|
| `production` | Production deploy | Production secrets |
| `preview` | Preview deploys | Staging/test secrets |
| `development` | `vercel dev` local | Local dev secrets |
| `plaintext` | Client + Server | Public values (NEXT_PUBLIC_*) |
| `encrypted` | Server only | API keys, tokens |

## Next.js Deployment Patterns

### App Router Deployment

```typescript
// app/page.tsx - Static (default)
export default function Page() {
  return <h1>Static Page</h1>
}

// app/dashboard/page.tsx - Dynamic
export const dynamic = "force-dynamic"
export default function DashboardPage() {
  return <h1>Dynamic Page</h1>
}

// app/blog/[slug]/page.tsx - ISR
export const revalidate = 3600 // Revalidate every hour
export default function BlogPost({ params }: { params: { slug: string } }) {
  return <h1>Blog: {params.slug}</h1>
}
```

### On-Demand Revalidation

```typescript
// app/api/revalidate/route.ts
import { revalidateTag } from "next/cache"
import { NextResponse } from "next/server"

export async function POST(request: Request) {
  const { tag } = await request.json()
  revalidateTag(tag)
  return NextResponse.json({ revalidated: true })
}
```

### Edge Middleware

```typescript
// middleware.ts
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

export const config = {
  matcher: ["/dashboard/:path*", "/api/protected/:path*"],
}

export function middleware(request: NextRequest) {
  const token = request.cookies.get("session")?.value

  if (!token && request.nextUrl.pathname.startsWith("/dashboard")) {
    return NextResponse.redirect(new URL("/login", request.url))
  }

  // Add headers
  const response = NextResponse.next()
  response.headers.set("x-edge-region", process.env.VERCEL_REGION ?? "unknown")
  return response
}
```

## Vercel Integrations

### Vercel Postgres

```typescript
import { sql } from "@vercel/postgres"

export async function getUsers() {
  const { rows } = await sql`SELECT * FROM users`
  return rows
}
```

### Vercel KV (Redis)

```typescript
import { kv } from "@vercel/kv"

// Cache data
await kv.set("user:1", { name: "John" }, { ex: 3600 })
const user = await kv.get("user:1")

// Rate limiting
const requests = await kv.incr("rate-limit:ip:123")
if (requests > 100) throw new Error("Rate limited")
```

### Vercel Blob (File Storage)

```typescript
import { put, list, del } from "@vercel/blob"

// Upload
const { url } = await put("uploads/image.jpg", file, { access: "public" })

// List
const { blobs } = await list({ prefix: "uploads/" })

// Delete
await del("uploads/image.jpg")
```

## Monorepo Configuration

### Turborepo + Vercel

```json
// turbo.json
{
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "!.next/cache/**"]
    }
  }
}
```

### pnpm Workspaces

```yaml
# vercel.json for monorepo
{
  "buildCommand": "cd apps/web && next build",
  "installCommand": "pnpm install"
}
```

## CI/CD with GitHub

Vercel automatically integrates with GitHub:

1. **Push to any branch** → Preview deployment created
2. **Push to main/production branch** → Production deployment
3. **PR comments** include preview URL automatically
4. **Automatic HTTPS/SSL** for custom domains

### GitHub Actions + Vercel

```yaml
name: Deploy to Vercel
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: amondnet/vercel-action@v25
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
          vercel-args: "--prod"
```

## Edge Functions vs Serverless Functions

| Feature | Edge Functions | Serverless Functions |
|---------|---------------|---------------------|
| **Runtime** | V8 Isolates (JavaScript/TypeScript) | Node.js, Python, Go, Ruby |
| **Memory** | 128 MB | 1024 MB (configurable) |
| **Duration** | 30s (user), 300s (pro) | 60s (Hobby), 900s (Pro) |
| **Cold Start** | ~1ms | ~50-500ms |
| **Location** | Edge (100+ regions) | Single region |
| **APIs** | Web APIs (Request/Response) | Full Node.js APIs |
| **Use Case** | Auth, redirects, A/B testing | Database queries, file processing |

## Environment-Specific Config

### Preview Deployments

```typescript
// Detect environment
const isPreview = process.env.VERCEL_ENV === "preview"
const isProduction = process.env.VERCEL_ENV === "production"

// Preview-specific database
const databaseUrl = isPreview
  ? process.env.STAGING_DATABASE_URL
  : process.env.DATABASE_URL
```

### Git-Informed Logic

```typescript
const branch = process.env.VERCEL_GIT_COMMIT_REF
const commitSha = process.env.VERCEL_GIT_COMMIT_SHA
```

## Common Pitfalls

1. **Serverless function timeout**: Default 10s (Hobby), increase via `maxDuration` in route segment config
2. **Cold starts**: Use Edge Functions for latency-sensitive paths, keep serverless functions warm with cron jobs
3. **Large bundle size**: Serverless functions have a 50MB limit (zipped); use dynamic imports
4. **Environment variable sync**: `NEXT_PUBLIC_*` vars are baked at build time; restart deploy after changing them
5. **Monorepo install issues**: Ensure `vercel.json` has correct `installCommand` for pnpm/yarn workspaces
6. **ISR stale data**: Use On-Demand Revalidation (`revalidateTag`) instead of time-based revalidation for dynamic content
7. **Middleware execution order**: Middleware runs before every matched route; keep it lightweight
8. **Custom domain DNS**: Point apex domain to `76.76.21.21` and CNAME `www` to `cname.vercel-dns.com`

## Vercel CLI Commands

```bash
# Install
npm i -g vercel

# Login
vercel login

# Link project
vercel link

# Pull environment variables
vercel env pull

# Local development
vercel dev

# Deploy preview
vercel

# Deploy production
vercel --prod

# List deployments
vercel list

# Inspect deployment
vercel inspect <url>

# Set environment variable
vercel env add SECRET_KEY

# Logs
vercel logs <deployment-url>
```
