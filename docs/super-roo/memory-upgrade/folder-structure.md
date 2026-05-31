# Folder Structure

```
~/.superroo/local-brain/
├── index.sqlite          # SQLite database for local storage
├── summaries/            # Project and session summaries
│   ├── current-project.json
│   ├── session-*.json
│   └── architecture-notes.json
├── cache/                # Cached responses from Central Brain
│   ├── lessons/
│   ├── architecture/
│   ├── bugs/
│   └── features/
├── logs/                 # Local brain activity logs
└── config.json           # Local brain configuration

# Alternative JSON structure (if SQLite not used)
~/.superroo/local-brain/
├── database.json         # Main JSON database
├── summaries/
├── cache/
├── logs/
└── config.json
```
