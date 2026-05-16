#!/usr/bin/env python3
"""Remove the test project from projects.json."""
import json

path = "/opt/superroo2/cloud/data/auth/projects.json"
projects = json.load(open(path))
projects = [p for p in projects if p["id"] != "proj_test_sync2"]
json.dump(projects, open(path, "w"), indent=2)
print(f"Cleaned. Remaining projects: {len(projects)}")
for p in projects:
    print(f"  - {p['name']} (user: {p['userId'][:8]}...)")
