#!/usr/bin/env python3
"""E2E test for project sync flow."""
import json
import subprocess
import sys

API = "http://localhost:8787"

def curl(method, path, headers=None, data=None):
    cmd = ["curl", "-s", "-X", method, f"{API}{path}"]
    if headers:
        for k, v in headers.items():
            cmd.extend(["-H", f"{k}: {v}"])
    if data:
        cmd.extend(["-H", "Content-Type: application/json", "-d", json.dumps(data)])
    result = subprocess.run(cmd, capture_output=True, text=True)
    try:
        return json.loads(result.stdout)
    except:
        return {"error": result.stdout}

def test(name, condition, detail=""):
    status = "✅ PASS" if condition else "❌ FAIL"
    print(f"  {status} | {name}")
    if not condition and detail:
        print(f"         {detail}")
    return condition

print("=" * 60)
print("E2E TEST: Project Sync Flow")
print("=" * 60)

# 1. Get a valid session token
print("\n[1] Getting auth token...")
with open("/opt/superroo2/cloud/data/auth/sessions.json") as f:
    sessions = json.load(f)
tokens = list(sessions.keys())
if not tokens:
    print("  ❌ No sessions found!")
    sys.exit(1)
token = tokens[0]
email = sessions[token]["email"]
print(f"  Using session for: {email}")

# 2. Test Telegram projects endpoint
print("\n[2] Testing Telegram projects endpoint...")
result = curl("POST", "/telegram/projects", data={
    "telegramUserId": 8485794779,
    "telegramChatId": 8485794779
})
test("Returns projects array", "projects" in result)
if "projects" in result:
    print(f"  Found {len(result['projects'])} projects:")
    for p in result['projects']:
        print(f"    - {p['name']} ({p['id']})")

# 3. Test project sync endpoint
print("\n[3] Testing project sync endpoint...")
result = curl("POST", "/api/projects/sync", 
    headers={"Authorization": f"Bearer {token}"},
    data={
        "projects": [
            {
                "id": "proj_e2e_test",
                "name": "e2e-test-project",
                "repoName": "e2e-test-project",
                "branch": "main",
                "status": "active",
                "language": "Python"
            }
        ]
    }
)
test("Sync returns ok", result.get("ok") == True, str(result))
if result.get("ok"):
    print(f"  Message: {result.get('message')}")

# 4. Verify project appears in Telegram
print("\n[4] Verifying project appears in Telegram...")
result = curl("POST", "/telegram/projects", data={
    "telegramUserId": 8485794779,
    "telegramChatId": 8485794779
})
found = any(p["id"] == "proj_e2e_test" for p in result.get("projects", []))
test("Synced project visible in Telegram", found, str(result.get("projects", [])))
if "projects" in result:
    print(f"  Total projects: {len(result['projects'])}")

# 5. Test presence sync
print("\n[5] Testing presence sync endpoint...")
result = curl("POST", "/api/projects/presence/sync",
    headers={"Authorization": f"Bearer {token}"},
    data={
        "projectId": "proj_e2e_test",
        "activeFile": "src/main.py",
        "currentTask": "Implement feature X",
        "activeAgent": "coder-agent"
    }
)
test("Presence sync returns ok", result.get("ok") == True, str(result))

# 6. Verify presence in Telegram projects
print("\n[6] Verifying presence data in Telegram...")
result = curl("POST", "/telegram/projects", data={
    "telegramUserId": 8485794779,
    "telegramChatId": 8485794779
})
e2e_project = next((p for p in result.get("projects", []) if p["id"] == "proj_e2e_test"), None)
test("Project has activeFile", e2e_project and e2e_project.get("activeFile") == "src/main.py", str(e2e_project))
test("Project has currentTask", e2e_project and e2e_project.get("currentTask") == "Implement feature X", str(e2e_project))

# 7. Test unauthorized access
print("\n[7] Testing unauthorized access...")
result = curl("POST", "/api/projects/sync",
    data={"projects": [{"name": "hacker-project"}]}
)
test("Rejects without auth", result.get("ok") == False, str(result))

print("\n" + "=" * 60)
print("E2E TEST COMPLETE")
print("=" * 60)
