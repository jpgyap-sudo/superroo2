#!/usr/bin/env python3
"""Test project sync endpoints on VPS."""
import json, urllib.request, urllib.error, sys

# Read a session token
sessions = json.load(open('/opt/superroo2/cloud/data/auth/sessions.json'))
token = list(sessions.keys())[0]
print(f"Using token: {token[:16]}... (for {sessions[token]['email']})")

# Test 1: Sync projects
req = urllib.request.Request(
    'http://localhost:8787/api/projects/sync',
    data=json.dumps({"projects": [{"id":"proj_test_sync2","name":"test-sync-project-2","repoName":"test-sync-2","branch":"main","status":"active","language":"JavaScript"}]}).encode(),
    headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {token}'}
)
try:
    resp = urllib.request.urlopen(req)
    print(f"Test 1 - Sync: {resp.status} {json.loads(resp.read())}")
except Exception as e:
    print(f"Test 1 - Sync FAILED: {e}")

# Test 2: Presence sync
req2 = urllib.request.Request(
    'http://localhost:8787/api/projects/presence/sync',
    data=json.dumps({"projectId":"proj_superroo2","activeFile":"test.ts","currentTask":"Testing sync","activeAgent":"Roo"}).encode(),
    headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {token}'}
)
try:
    resp2 = urllib.request.urlopen(req2)
    print(f"Test 2 - Presence: {resp2.status} {json.loads(resp2.read())}")
except Exception as e:
    print(f"Test 2 - Presence FAILED: {e}")

# Test 3: Unauthorized
req3 = urllib.request.Request(
    'http://localhost:8787/api/projects/sync',
    data=json.dumps({"projects": []}).encode(),
    headers={'Content-Type': 'application/json'}
)
try:
    resp3 = urllib.request.urlopen(req3)
    print(f"Test 3 - No auth SHOULD FAIL: got {resp3.status}")
except urllib.error.HTTPError as e:
    print(f"Test 3 - No auth correctly rejected: {e.code}")

# Test 4: Verify projects.json has the new project
projects = json.load(open('/opt/superroo2/cloud/data/auth/projects.json'))
print(f"\nTotal projects: {len(projects)}")
for p in projects:
    print(f"  - {p['name']} (user: {p['userId'][:8]}...)")
