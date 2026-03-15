---
name: code-search
description: Semantic code search across the codebase. Returns structured results with file paths, line numbers, and relevance scores. Use for all code exploration, finding implementations, locating files, and answering codebase questions.
category: exploration
allowed-tools: Bash(bun x codebasesearch*)
input-schema:
  type: object
  required: [prompt]
  properties:
    prompt:
      type: string
      minLength: 3
      maxLength: 200
      description: Natural language search query describing what you're looking for
    context:
      type: object
      description: Optional context about search scope and restrictions
      properties:
        path:
          type: string
          description: Restrict search to this directory path (relative or absolute)
        file-types:
          type: array
          items: { type: string }
          description: Filter results by file extensions (e.g., ["js", "ts", "py"])
        exclude-patterns:
          type: array
          items: { type: string }
          description: Exclude paths matching glob patterns (e.g., ["node_modules", "*.test.js"])
    filter:
      type: object
      description: Output filtering and formatting options
      properties:
        max-results:
          type: integer
          minimum: 1
          maximum: 500
          default: 50
          description: Maximum number of results to return
        min-score:
          type: number
          minimum: 0
          maximum: 1
          default: 0.5
          description: Minimum relevance score (0-1) to include in results
        sort-by:
          type: string
          enum: [relevance, path, line-number]
          default: relevance
          description: Result sort order
    timeout:
      type: integer
      minimum: 1000
      maximum: 30000
      default: 10000
      description: Search timeout in milliseconds (query returns partial results if exceeded)
output-schema:
  type: object
  required: [status, results, meta]
  properties:
    status:
      type: string
      enum: [success, partial, empty, timeout, error]
      description: Overall operation status
    results:
      type: array
      description: Array of matching code locations
      items:
        type: object
        required: [file, line, content, score]
        properties:
          file:
            type: string
            description: Absolute or relative file path to matched file
          line:
            type: integer
            description: Line number where match occurs (1-indexed)
          content:
            type: string
            description: The matched line or context snippet
          score:
            type: number
            minimum: 0
            maximum: 1
            description: Relevance score where 1.0 is perfect match
          context:
            type: object
            description: Surrounding context lines (optional)
            properties:
              before:
                type: array
                items: { type: string }
                description: Lines before the match
              after:
                type: array
                items: { type: string }
                description: Lines after the match
          metadata:
            type: object
            description: File and match metadata (optional)
            properties:
              language:
                type: string
                description: Programming language detected (js, ts, py, rs, go, etc.)
              size:
                type: integer
                description: File size in bytes
              modified:
                type: string
                format: date-time
                description: Last modification timestamp
    meta:
      type: object
      required: [query, count, duration_ms]
      description: Query execution metadata
      properties:
        query:
          type: string
          description: Normalized query that was executed
        count:
          type: integer
          description: Total matches found (before filtering)
        filtered:
          type: integer
          description: Results returned (after filtering and limiting)
        duration_ms:
          type: integer
          description: Execution time in milliseconds
        scanned_files:
          type: integer
          description: Total files examined during search
        timestamp:
          type: string
          format: date-time
          description: When execution completed
    errors:
      type: array
      description: Non-fatal errors that occurred (may appear alongside partial results)
      items:
        type: object
        properties:
          code:
            type: string
            enum: [TIMEOUT, INVALID_PATH, SCHEMA_VIOLATION, EXECUTION_FAILED]
            description: Error classification
          message:
            type: string
            description: Human-readable error description
output-format: json
error-handling:
  timeout:
    behavior: return-partial
    description: Returns results collected before timeout with status=partial
  invalid-input:
    behavior: reject
    description: Returns status=error with validation errors in errors array
  empty-results:
    behavior: return-empty
    description: Returns status=empty with count=0, filtered=0, results=[]
  execution-error:
    behavior: return-error
    description: Returns status=error with error details in errors array
---

# Semantic Code Search

Only use bun x codebasesearch for searching code, or execute some custom code if you need more than that, never use other cli tools to search the codebase. Search the codebase using natural language. Do multiple searches when looking for files, starting with fewer words and adding more if you need to refine the search. 102 file types are covered, returns results with file paths and line numbers.

## Usage

```bash
bun x codebasesearch "your natural language query"
```

## Invocation Examples

### Via Skill Tool (Recommended - Structured JSON Input)

**Basic search**:
```json
{
  "prompt": "where is authentication handled"
}
```

**With filtering and limits**:
```json
{
  "prompt": "database connection setup",
  "filter": {
    "max-results": 20,
    "min-score": 0.7,
    "sort-by": "path"
  }
}
```

**Scoped to directory with file type filter**:
```json
{
  "prompt": "error logging middleware",
  "context": {
    "path": "src/middleware/",
    "file-types": ["js", "ts"]
  },
  "timeout": 5000
}
```

**Exclude patterns and narrow results**:
```json
{
  "prompt": "rate limiter implementation",
  "context": {
    "exclude-patterns": ["*.test.js", "node_modules/*"]
  },
  "filter": {
    "max-results": 10,
    "min-score": 0.8
  }
}
```

### Legacy CLI Invocation (Still Supported)

```bash
bun x codebasesearch "where is authentication handled"
bun x codebasesearch "database connection setup"
bun x codebasesearch "how are errors logged"
bun x codebasesearch "function that parses config files"
bun x codebasesearch "where is the rate limiter"
```

## Output Examples

### Success Response (Multiple Results)

```json
{
  "status": "success",
  "results": [
    {
      "file": "src/auth/handler.js",
      "line": 42,
      "content": "async function authenticateUser(credentials) {",
      "score": 0.95,
      "context": {
        "before": [
          "// Main authentication entry point",
          ""
        ],
        "after": [
          "  const { username, password } = credentials;",
          "  const user = await db.users.findOne({ username });"
        ]
      },
      "metadata": {
        "language": "javascript",
        "size": 2048,
        "modified": "2025-03-10T14:23:00Z"
      }
    },
    {
      "file": "src/middleware/auth-middleware.js",
      "line": 18,
      "content": "export const requireAuth = (req, res, next) => {",
      "score": 0.78,
      "metadata": {
        "language": "javascript",
        "size": 1024,
        "modified": "2025-03-10T14:20:00Z"
      }
    }
  ],
  "meta": {
    "query": "authentication handled",
    "count": 2,
    "filtered": 2,
    "duration_ms": 245,
    "scanned_files": 87,
    "timestamp": "2025-03-15T10:30:00Z"
  }
}
```

### Empty Results Response

```json
{
  "status": "empty",
  "results": [],
  "meta": {
    "query": "nonexistent pattern xyz123",
    "count": 0,
    "filtered": 0,
    "duration_ms": 123,
    "scanned_files": 87,
    "timestamp": "2025-03-15T10:30:00Z"
  }
}
```

### Timeout Response (Partial Results)

```json
{
  "status": "partial",
  "results": [
    {
      "file": "src/a.js",
      "line": 5,
      "content": "function init() {",
      "score": 0.92,
      "metadata": { "language": "javascript", "size": 512 }
    },
    {
      "file": "src/b.js",
      "line": 12,
      "content": "const setup = () => {",
      "score": 0.85,
      "metadata": { "language": "javascript", "size": 768 }
    }
  ],
  "meta": {
    "query": "expensive search pattern",
    "count": 1847,
    "filtered": 2,
    "duration_ms": 10000,
    "scanned_files": 45,
    "timestamp": "2025-03-15T10:30:00Z"
  },
  "errors": [
    {
      "code": "TIMEOUT",
      "message": "Search exceeded 10000ms limit. Returning partial results (2 of 1847 matches)."
    }
  ]
}
```

### Error Response (Invalid Input)

```json
{
  "status": "error",
  "results": [],
  "meta": {
    "query": null,
    "count": 0,
    "filtered": 0,
    "duration_ms": 50,
    "scanned_files": 0,
    "timestamp": "2025-03-15T10:30:00Z"
  },
  "errors": [
    {
      "code": "INVALID_PATH",
      "message": "context.path='/nonexistent' does not exist"
    },
    {
      "code": "SCHEMA_VIOLATION",
      "message": "filter.max-results must be between 1 and 500, got 1000"
    }
  ]
}
```

## Rules

- Always use this first before reading files — it returns file paths and line numbers
- Natural language queries work best; be descriptive about what you're looking for
- Structured JSON output includes relevance scores and file paths for immediate navigation
- Use returned file paths and line numbers to read full file context via Read tool
- Results are pre-sorted by relevance (highest scores first) unless sort-by specifies otherwise
- Timeout queries return partial results with status=partial — use if time-critical
- Schema validation ensures valid input before execution — invalid args return error with details
