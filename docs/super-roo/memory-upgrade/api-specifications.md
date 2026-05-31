# API Specifications for SuperRoo Central Brain

The Central Brain exposes a REST API that the MCP Bridge can interact with. Alternatively, the MCP server can directly interface with the Central Brain's database or services.

## Base URL

`http://central-brain.superroo.local:3419/api/v1` (or as configured)

## Authentication

Bearer token or API key in headers: `Authorization: Bearer <token>`

## Endpoints

### 1. Project Memories

#### GET /projects/{project_id}/summary

Get the summary of a project.
**Response:**

```json
{
	"project_id": "string",
	"name": "string",
	"description": "string",
	"architecture_notes": "string",
	"key_files": ["string"],
	"dependencies": [
		{
			"name": "string",
			"version": "string",
			"type": "string"
		}
	],
	"recent_changes": [
		{
			"commit_sha": "string",
			"message": "string",
			"author": "string",
			"timestamp": "string"
		}
	],
	"last_updated": "string (ISO timestamp)"
}
```

#### PUT /projects/{project_id}/summary

Update or create a project summary.
**Request Body:** Same as GET response
**Response:** 200 OK

### 2. Lessons Learned

#### GET /lessons

Search lessons with query parameters.
**Parameters:**

- `q` (string): Search query
- `tags` (string): Comma-separated tags
- `category` (string): Lesson category
- `min_confidence` (number): Minimum confidence
- `limit` (integer): Maximum results (default: 10)
- `project_id` (string): Filter by project

**Response:**

```json
{
	"lessons": [
		{
			"id": "string",
			"title": "string",
			"content": "string",
			"project": "string",
			"tags": ["string"],
			"category": "string",
			"risk_level": "string",
			"confidence": "number",
			"source": "string",
			"files_affected": ["string"],
			"created_at": "string (ISO timestamp)"
		}
	]
}
```

#### POST /lessons

Create a new lesson.
**Request Body:**

```json
{
	"title": "string",
	"content": "string",
	"project": "string",
	"tags": ["string"],
	"category": "string",
	"risk_level": "string",
	"confidence": "number",
	"source": "string",
	"files_affected": ["string"]
}
```

**Response:** 201 Created with lesson ID

### 3. Architecture Patterns

#### GET /architecture

Search architecture patterns.
**Parameters:**

- `q` (string): Search query
- `pattern_name` (string): Specific pattern name
- `limit` (integer): Maximum results

**Response:**

```json
{
	"patterns": [
		{
			"id": "string",
			"name": "string",
			"description": "string",
			"diagram": "string",
			"applicability": "string",
			"projects": ["string"]
		}
	]
}
```

#### POST /architecture

Add a new architecture pattern.
**Request Body:**

```json
{
	"name": "string",
	"description": "string",
	"diagram": "string",
	"applicability": "string"
}
```

**Response:** 201 Created

### 4. Bug Resolutions

#### GET /bugs

Search bug resolutions.
**Parameters:**

- `q` (string): Search query
- `bug_id` (string): Specific bug ID
- `project_id` (string): Filter by project
- `resolved` (boolean): Filter by resolution status

**Response:**

```json
{
	"bugs": [
		{
			"id": "string",
			"title": "string",
			"description": "string",
			"steps_to_reproduce": ["string"],
			"resolution": "string",
			"project_id": "string",
			"reported_at": "string (ISO timestamp)",
			"resolved_at": "string (ISO timestamp, optional)"
		}
	]
}
```

#### POST /bugs

Log a new bug or resolution.
**Request Body:**

```json
{
	"title": "string",
	"description": "string",
	"steps_to_reproduce": ["string"],
	"resolution": "string",
	"project_id": "string"
}
```

**Response:** 201 Created

### 5. Feature History

#### GET /features

Search feature history.
**Parameters:**

- `q` (string): Search query
- `feature_id` (string): Specific feature ID
- `project_id` (string): Filter by project
- `status` (string): Filter by implementation status

**Response:**

```json
{
	"features": [
		{
			"id": "string",
			"name": "string",
			"description": "string",
			"specification": "string",
			"implementation_status": "string",
			"project_id": "string",
			"created_at": "string (ISO timestamp)",
			"completed_at": "string (ISO timestamp, optional)"
		}
	]
}
```

#### POST /features

Record a feature implementation.
**Request Body:**

```json
{
	"name": "string",
	"description": "string",
	"specification": "string",
	"project_id": "string"
}
```

**Response:** 201 Created

### 6. Health Check

#### GET /health

Check if the Central Brain is operational.
**Response:** 200 OK with `{ status: "healthy" }`

### 7. Sync Endpoints (for MCP Bridge)

#### POST /sync/local-lessons

Endpoint for the MCP Bridge to batch-sync local lessons that meet confidence threshold.
**Request Body:**

```json
{
	"lessons": [
		{
			"local_id": "string",
			"title": "string",
			"content": "string",
			"project": "string",
			"tags": ["string"],
			"category": "string",
			"risk_level": "string",
			"confidence": "number",
			"source": "string",
			"files_affected": ["string"]
		}
	]
}
```

**Response:**

```json
{
	"synced": [
		{
			"local_id": "string",
			"central_id": "string"
		}
	],
	"failed": [
		{
			"local_id": "string",
			"error": "string"
		}
	]
}
```
