---
name: google-cloud-api
description: ☁️ Google Cloud API — Integrate Google Cloud services (GCP APIs, auth, storage, AI/ML, databases, serverless) into SuperRoo apps
---

# Google Cloud API Skill

## When To Use

Use this skill when the user asks to integrate Google Cloud Platform (GCP) services, use Google APIs, sync data with Google services, or build features that leverage Google Cloud infrastructure.

Also use this skill when tasks involve:
- Google Cloud Storage (buckets, objects)
- Google Cloud AI/ML services (Vertex AI, Natural Language, Vision, Translation)
- Google Cloud Databases (Firestore, BigQuery, Cloud SQL, Spanner)
- Google Cloud Serverless (Cloud Functions, Cloud Run, App Engine)
- Google Cloud Pub/Sub, Cloud Tasks, Eventarc
- Google Cloud IAM, Secret Manager, KMS
- Google Cloud Monitoring, Logging, Error Reporting
- Google Workspace APIs (Drive, Sheets, Docs, Gmail, Calendar)
- Authentication with Google OAuth 2.0 or service accounts
- Google Cloud SDK, gcloud CLI, or client libraries

## Core Concepts

### Google Cloud APIs Overview

Google Cloud APIs are programmatic interfaces to Google Cloud Platform services. They use:

- **RESTful HTTP/JSON** endpoints (most services)
- **gRPC** endpoints (many services support both)
- **Client libraries** in multiple languages (Node.js, Python, Go, Java, etc.)
- **Google API Client** libraries for broader Google APIs (Workspace, YouTube, etc.)

Base URL pattern: `https://SERVICE.googleapis.com/` (e.g., `https://storage.googleapis.com/`, `https://vision.googleapis.com/`)

### Authentication Methods

| Method | Use Case | Credential Type |
|--------|----------|-----------------|
| **Service Account** | Server-to-server, backend services | JSON key file (`GOOGLE_APPLICATION_CREDENTIALS`) |
| **OAuth 2.0** | User-facing apps (Drive, Gmail, Calendar) | Client ID + Client Secret + Refresh Token |
| **API Key** | Public data, simple access control | API key string |
| **Workload Identity** | GKE/GCE workloads | Metadata server |
| **ADC (Application Default Credentials)** | Local dev, GCP-hosted workloads | Auto-detected chain |

### Service Account Auth Flow (Backend)

1. Create a service account in GCP Console → IAM → Service Accounts
2. Grant the service account the required IAM roles
3. Generate a JSON key file and download it
4. Set `GOOGLE_APPLICATION_CREDENTIALS` env var to the key file path
5. Use the client library — it auto-detects credentials

### OAuth 2.0 Auth Flow (User-Facing)

1. Create OAuth 2.0 credentials in GCP Console → APIs & Services → Credentials
2. Configure authorized redirect URIs
3. Use the Google Identity Services library or client library to initiate auth
4. Request scopes for the specific APIs needed
5. Handle token refresh (access tokens expire after 1 hour)

## Common GCP Services & Client Libraries

### Storage

| Service | Node.js Package | Key Concepts |
|---------|----------------|--------------|
| Cloud Storage | `@google-cloud/storage` | Buckets, Objects, Signed URLs, Lifecycle rules |
| Firestore | `@google-cloud/firestore` | Collections, Documents, Queries, Real-time listeners |
| BigQuery | `@google-cloud/bigquery` | Datasets, Tables, SQL queries, Streaming inserts |

```typescript
// Cloud Storage example
import { Storage } from '@google-cloud/storage';
const storage = new Storage();
const bucket = storage.bucket('my-bucket');
await bucket.upload('local-file.txt', { destination: 'remote-file.txt' });
```

### AI / Machine Learning

| Service | Node.js Package | Key Concepts |
|---------|----------------|--------------|
| Vertex AI | `@google-cloud/vertexai` | Generative models, embeddings, tuning |
| Natural Language | `@google-cloud/language` | Entity extraction, sentiment, syntax |
| Vision | `@google-cloud/vision` | Image labeling, OCR, face detection |
| Translation | `@google-cloud/translate` | Text translation, language detection |
| Speech-to-Text | `@google-cloud/speech` | Audio transcription, streaming |
| Text-to-Speech | `@google-cloud/text-to-speech` | Audio synthesis, SSML |

```typescript
// Vertex AI example
import { VertexAI } from '@google-cloud/vertexai';
const vertexAI = new VertexAI({ project: 'my-project', location: 'us-central1' });
const model = vertexAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
const result = await model.generateContent('Hello world');
```

### Databases

| Service | Node.js Package | Key Concepts |
|---------|----------------|--------------|
| Firestore | `@google-cloud/firestore` | NoSQL, real-time, auto-scaling |
| BigQuery | `@google-cloud/bigquery` | Analytics, SQL, large datasets |
| Cloud SQL | `@google-cloud/sql` | MySQL, PostgreSQL, SQL Server (via drivers) |
| Cloud Spanner | `@google-cloud/spanner` | Globally distributed, strongly consistent |

### Serverless / Compute

| Service | Node.js Package / SDK | Key Concepts |
|---------|----------------------|--------------|
| Cloud Functions | `@google-cloud/functions-framework` | Event-driven, HTTP triggers, background |
| Cloud Run | `gcloud run deploy` | Containerized, auto-scaling to zero |
| App Engine | `gcloud app deploy` | Platform-as-a-Service, standard/flexible |
| GKE | `@google-cloud/container` | Kubernetes, node pools, workloads |

### Messaging / Event-Driven

| Service | Node.js Package | Key Concepts |
|---------|----------------|--------------|
| Pub/Sub | `@google-cloud/pubsub` | Topics, Subscriptions, Push/Pull, exactly-once |
| Cloud Tasks | `@google-cloud/tasks` | HTTP target, App Engine target, retry config |
| Eventarc | `@google-cloud/eventarc` | Event-driven, CloudEvents format |

```typescript
// Pub/Sub example
import { PubSub } from '@google-cloud/pubsub';
const pubsub = new PubSub();
const topic = pubsub.topic('my-topic');
await topic.publishMessage({ data: Buffer.from('Hello') });
```

### Security / Identity

| Service | Node.js Package | Key Concepts |
|---------|----------------|--------------|
| Secret Manager | `@google-cloud/secret-manager` | Secrets, versions, IAM access |
| Cloud KMS | `@google-cloud/kms` | Encryption keys, crypto keys, signing |
| IAM | `@google-cloud/iam` | Roles, policies, service accounts |

### Monitoring / Observability

| Service | Node.js Package | Key Concepts |
|---------|----------------|--------------|
| Cloud Monitoring | `@google-cloud/monitoring` | Metrics, alerts, dashboards |
| Cloud Logging | `@google-cloud/logging` | Log entries, sinks, metrics |
| Error Reporting | `@google-cloud/error-reporting` | Error groups, stack traces |

## Google Workspace APIs

For user-facing Google services (requires OAuth 2.0):

| API | Node.js Package | Scopes |
|-----|----------------|--------|
| Google Drive | `googleapis` (drive v3) | `https://www.googleapis.com/auth/drive` |
| Google Sheets | `googleapis` (sheets v4) | `https://www.googleapis.com/auth/spreadsheets` |
| Google Docs | `googleapis` (docs v1) | `https://www.googleapis.com/auth/documents` |
| Gmail | `googleapis` (gmail v1) | `https://www.googleapis.com/auth/gmail.modify` |
| Google Calendar | `googleapis` (calendar v3) | `https://www.googleapis.com/auth/calendar` |

```typescript
// Google Sheets example using googleapis
import { google } from 'googleapis';
const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
auth.setCredentials({ refresh_token: refreshToken });
const sheets = google.sheets({ version: 'v4', auth });
const res = await sheets.spreadsheets.values.get({
  spreadsheetId: '...',
  range: 'Sheet1!A1:E10',
});
```

## gcloud CLI Common Commands

```bash
# Authentication
gcloud auth login                          # Interactive login
gcloud auth activate-service-account --key-file=key.json
gcloud config set project my-project

# Storage
gcloud storage cp file.txt gs://bucket/
gcloud storage rsync ./dir gs://bucket/dir

# Cloud Run
gcloud run deploy my-service --image gcr.io/my-project/my-image --region us-central1

# Cloud Functions
gcloud functions deploy my-function --runtime nodejs20 --trigger-http --allow-unauthenticated

# IAM
gcloud iam service-accounts create my-sa --display-name="My Service Account"
gcloud projects add-iam-policy-binding my-project --member="serviceAccount:my-sa@my-project.iam.gserviceaccount.com" --role="roles/storage.objectAdmin"

# Secrets
gcloud secrets create my-secret --replication-policy="automatic"
gcloud secrets versions add my-secret --data-file="secret.txt"

# Pub/Sub
gcloud pubsub topics create my-topic
gcloud pubsub subscriptions create my-sub --topic=my-topic
```

## Environment Setup

### Local Development

```bash
# Install Google Cloud SDK
# https://cloud.google.com/sdk/docs/install

# Authenticate
gcloud auth application-default login

# Set project
gcloud config set project YOUR_PROJECT_ID

# Install client library
npm install @google-cloud/storage @google-cloud/firestore @google-cloud/vertexai
```

### Environment Variables

```env
GOOGLE_APPLICATION_CREDENTIALS=./path/to/service-account-key.json
GCP_PROJECT_ID=my-project-id
GCP_REGION=us-central1
GCP_BUCKET_NAME=my-app-bucket
```

### Production (GCP-hosted)

On GCP services (Cloud Run, GKE, Compute Engine), ADC auto-detects credentials from the metadata server. No key file needed — just grant the compute service account the required IAM roles.

## Common Patterns

### Pattern 1: Signed URLs for Cloud Storage

```typescript
const [url] = await storage
  .bucket(bucketName)
  .file(fileName)
  .getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + 15 * 60 * 1000, // 15 minutes
  });
```

### Pattern 2: Firestore Real-time Listener

```typescript
const unsubscribe = firestore
  .collection('users')
  .where('status', '==', 'active')
  .onSnapshot((snapshot) => {
    snapshot.docChanges().forEach((change) => {
      console.log(change.type, change.doc.id, change.doc.data());
    });
  });
```

### Pattern 3: Pub/Sub Push Subscription Handler (Cloud Function)

```typescript
import { CloudEvent } from '@google-cloud/functions-framework';

export const handlePubSub = async (cloudEvent: CloudEvent) => {
  const data = Buffer.from(cloudEvent.data!.message.data, 'base64').toString();
  console.log('Received message:', data);
};
```

### Pattern 4: Vertex AI with Gemini

```typescript
import { VertexAI } from '@google-cloud/vertexai';

const vertexAI = new VertexAI({ project: process.env.GCP_PROJECT_ID, location: 'us-central1' });
const generativeModel = vertexAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

const chat = generativeModel.startChat();
const result = await chat.sendMessage('Explain quantum computing');
console.log(result.response.text());
```

## IAM Roles Quick Reference

| Role | ID | Use Case |
|------|----|----------|
| Storage Object Admin | `roles/storage.objectAdmin` | Full control over objects |
| Storage Object Viewer | `roles/storage.objectViewer` | Read-only object access |
| Firestore User | `roles/datastore.user` | Read/write Firestore data |
| BigQuery Data Editor | `roles/bigquery.dataEditor` | Query and modify datasets |
| Pub/Sub Publisher | `roles/pubsub.publisher` | Publish messages |
| Pub/Sub Subscriber | `roles/pubsub.subscriber` | Consume messages |
| Vertex AI User | `roles/aiplatform.user` | Use Vertex AI models |
| Secret Manager Accessor | `roles/secretmanager.secretAccessor` | Read secret values |
| Cloud Run Invoker | `roles/run.invoker` | Invoke Cloud Run services |
| Service Account User | `roles/iam.serviceAccountUser` | Act as a service account |

## Error Handling

Common GCP errors and their causes:

| Error | Likely Cause | Fix |
|-------|-------------|-----|
| `PERMISSION_DENIED` | IAM role missing or wrong credentials | Check service account roles and key file |
| `NOT_FOUND` | Resource doesn't exist or wrong project | Verify project ID and resource name |
| `QUOTA_EXCEEDED` | API rate limit hit | Implement exponential backoff |
| `DEADLINE_EXCEEDED` | Operation timed out | Increase timeout or reduce batch size |
| `UNAUTHENTICATED` | Invalid or expired credentials | Refresh token or check ADC setup |
| `ALREADY_EXISTS` | Resource already exists | Use upsert pattern or check before create |

## Best Practices

1. **Never commit service account keys** to version control — use Secret Manager or environment variables
2. **Use the principle of least privilege** — grant only the IAM roles needed
3. **Enable VPC Service Controls** for sensitive data
4. **Use Cloud Tasks or Pub/Sub** for async/background processing
5. **Set up Cloud Monitoring alerts** for error rates and latency
6. **Use Cloud Logging** with structured logs for observability
7. **Implement retry with exponential backoff** for all API calls
8. **Use Signed URLs** for temporary object access instead of public buckets
9. **Use Cloud KMS** for customer-managed encryption keys (CMEK)
10. **Enable API keys restrictions** (HTTP referrers, IP addresses, APIs)
