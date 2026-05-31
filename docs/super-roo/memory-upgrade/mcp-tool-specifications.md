# MCP Tool Specifications

The SuperRoo MCP Bridge exposes the following tools:

## 1. memory_search

Search for information in local memory, falling back to Central Brain if not found locally.

**Parameters:**

- `query` (string): The search query
- `category` (string, optional): Category to search in (lesson, architecture, bug, feature, summary)
- `limit` (integer, optional): Maximum number of results (default: 10)
- `use_cache` (boolean, optional): Whether to use local cache (default: true)

**Returns:**

- `results` (array): Array of matching items, each with:
    - `id` (string)
    - `type` (string)
    - `title` (string)
    - `content` (string or object)
    - `source` (string): 'local' or 'central_brain'
    - `relevance` (float): 0.0 to 1.0
    - `timestamp` (string): ISO timestamp

## 2. memory_store

Store information in local memory and optionally sync to Central Brain.

**Parameters:**

- `key` (string): Unique identifier for the item
- `value` (object): The data to store
- `category` (string): Category of the item (lesson, architecture, bug, feature, summary)
- `tags` (array of strings, optional): Tags for categorization
- `sync_to_central` (boolean, optional): Whether to sync to Central Brain (default: false)
- `project_id` (string, optional): Identifier for the project

**Returns:**

- `success` (boolean)
- `local_id` (string): Identifier in local storage
- `central_id` (string, optional): Identifier in Central Brain if synced

## 3. lesson_store

Store a lesson learned, with scoring and potential sync to Central Brain.

**Parameters:**

- `title` (string): Lesson title
- `content` (string): Detailed lesson content
- `project` (string): Project identifier
- `tags` (array of strings): Tags for the lesson
- `category` (string): Lesson category (architecture, bug, deployment, testing, security, performance, product, ui, database)
- `risk_level` (string): Risk level (low, medium, high)
- `confidence` (float): Confidence score (0.0 to 1.0)
- `source` (string): Agent or source that generated the lesson
- `files_affected` (array of strings, optional): Files related to the lesson
- `sync_if_above_confidence` (float, optional): Minimum confidence to sync to Central Brain (default: 0.7)

**Returns:**

- `success` (boolean)
- `local_lesson_id` (string): Identifier in local temporary lessons
- `central_lesson_id` (string, optional): Identifier in Central Brain if synced
- `reason` (string): Explanation if not synced

## 4. lesson_search

Search for lessons in local memory and Central Brain.

**Parameters:**

- `query` (string): Search query
- `tags` (array of strings, optional): Filter by tags
- `category` (string, optional): Filter by category
- `min_confidence` (float, optional): Minimum confidence threshold (default: 0.0)
- `limit` (integer, optional): Maximum results (default: 10)

**Returns:**

- `lessons` (array): Array of lesson objects with:
    - `id` (string)
    - `title` (string)
    - `content` (string)
    - `project` (string)
    - `tags` (array)
    - `category` (string)
    - `risk_level` (string)
    - `confidence` (float)
    - `source` (string)
    - `files_affected` (array)
    - `created_at` (string)
    - `source` (string): 'local' or 'central_brain'

## 5. project_summary

Get or create a summary of the current project.

**Parameters:**

- `project_id` (string, optional): Identifier for the project (if not provided, uses current)
- `force_refresh` (boolean, optional): Whether to force refresh from Central Brain (default: false)

**Returns:**

- `summary` (object):
    - `project_id` (string)
    - `name` (string)
    - `description` (string)
    - `architecture_notes` (string)
    - `key_files` (array of strings)
    - `dependencies` (array of objects)
    - `recent_changes` (array of objects)
    - `last_updated` (string)

## 6. architecture_lookup

Look up architecture patterns or decisions.

**Parameters:**

- `pattern_name` (string, optional): Name of the architecture pattern
- `project_id` (string, optional): Project to scope the lookup
- `use_cache` (boolean, optional): Whether to use local cache (default: true)

**Returns:**

- `patterns` (array): Array of architecture pattern objects with:
    - `name` (string)
    - `description` (string)
    - `diagram` (string, optional): Mermaid or text diagram
    - `applicability` (string)
    - `source` (string): 'local' or 'central_brain'
    - `project_id` (string, optional)

## 7. bug_lookup

Look up bug resolutions and known issues.

**Parameters:**

- `bug_id` (string, optional): Specific bug identifier
- `query` (string, optional): Search query for bug symptoms
- `project_id` (string, optional): Project to scope the lookup
- `include_resolved` (boolean, optional): Whether to include resolved bugs (default: true)

**Returns:**

- `bugs` (array): Array of bug objects with:
    - `id` (string)
    - `title` (string)
    - `description` (string)
    - `steps_to_reproduce` (array)
    - `resolution` (string)
    - `project_id` (string)
    - `reported_at` (string)
    - `resolved_at` (string, optional)
    - `source` (string): 'local' or 'central_brain'

## 8. feature_lookup

Look up feature implementations and specifications.

**Parameters:**

- `feature_id` (string, optional): Specific feature identifier
- `query` (string, optional): Search query for feature description
- `project_id` (string, optional): Project to scope the lookup
- `include_planned` (boolean, optional): Whether to include planned features (default: false)

**Returns:**

- `features` (array): Array of feature objects with:
    - `id` (string)
    - `name` (string)
    - `description` (string)
    - `specification` (string)
    - `implementation_status` (string): 'planned', 'in_progress', 'completed', 'deprecated'
    - `project_id` (string)
    - `created_at` (string)
    - `completed_at` (string, optional)
    - `source` (string): 'local' or 'central_brain'
