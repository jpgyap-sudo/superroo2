#!/usr/bin/env python3
"""Create projects.json with the user's workspaces."""
import json
import os

PROJECTS_FILE = "/opt/superroo2/cloud/data/auth/projects.json"

projects = [
    {
        "id": "proj_superroo2",
        "userId": "usr_574bfe302e53b024a647e395",
        "name": "superroo2",
        "repoName": "superroo2",
        "branch": "main",
        "status": "active",
        "language": "TypeScript",
        "localPath": "/opt/superroo2",
        "repoUrl": "https://github.com/jpgy888/superroo2",
        "lastActivityAt": "2026-05-10T02:00:00.000Z"
    },
    {
        "id": "proj_productgenerator",
        "userId": "usr_574bfe302e53b024a647e395",
        "name": "productgenerator",
        "repoName": "productgenerator",
        "branch": "main",
        "status": "active",
        "language": "TypeScript",
        "localPath": None,
        "repoUrl": None,
        "lastActivityAt": "2026-05-10T02:00:00.000Z"
    },
    {
        "id": "proj_quotation_automation_system",
        "userId": "usr_574bfe302e53b024a647e395",
        "name": "quotation-automation-system",
        "repoName": "quotation-automation-system",
        "branch": "main",
        "status": "active",
        "language": None,
        "localPath": None,
        "repoUrl": None,
        "lastActivityAt": None
    }
]

os.makedirs(os.path.dirname(PROJECTS_FILE), exist_ok=True)
with open(PROJECTS_FILE, "w") as f:
    json.dump(projects, f, indent=2)

print(f"Created {PROJECTS_FILE} with {len(projects)} projects")
