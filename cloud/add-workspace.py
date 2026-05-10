#!/usr/bin/env python3
"""Add a workspace to the user's projects.json on the VPS."""
import json
import sys
import os

PROJECTS_FILE = "/opt/superroo2/cloud/data/auth/projects.json"

def add_workspace(name, repo_name=None, branch="main", language=None):
    """Add a workspace to projects.json if it doesn't already exist."""
    # Load existing projects
    projects = json.load(open(PROJECTS_FILE))
    
    # Check if already exists
    existing = [p for p in projects if p["name"] == name or p["repoName"] == (repo_name or name)]
    if existing:
        print(f"Workspace '{name}' already exists (id: {existing[0]['id']})")
        return existing[0]
    
    # Find the user ID from existing projects
    user_id = None
    for p in projects:
        if p.get("userId"):
            user_id = p["userId"]
            break
    
    if not user_id:
        print("ERROR: No existing projects found to determine user ID")
        sys.exit(1)
    
    # Create new project entry
    new_project = {
        "id": f"proj_{name.lower().replace('-', '_').replace(' ', '_')}",
        "userId": user_id,
        "name": name,
        "repoName": repo_name or name,
        "branch": branch,
        "status": "active",
        "language": language or None,
        "localPath": None,
        "repoUrl": None,
        "lastActivityAt": None
    }
    
    projects.append(new_project)
    json.dump(projects, open(PROJECTS_FILE, "w"), indent=2)
    print(f"✅ Added workspace '{name}' (id: {new_project['id']})")
    print(f"   Total projects: {len(projects)}")
    return new_project


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 add-workspace.py <workspace-name> [repo-name] [branch] [language]")
        print("")
        print("Examples:")
        print("  python3 add-workspace.py quotation-automation-system")
        print("  python3 add-workspace.py my-app my-app-repo main TypeScript")
        sys.exit(1)
    
    name = sys.argv[1]
    repo_name = sys.argv[2] if len(sys.argv) > 2 else None
    branch = sys.argv[3] if len(sys.argv) > 3 else "main"
    language = sys.argv[4] if len(sys.argv) > 4 else None
    
    add_workspace(name, repo_name, branch, language)
