"""快速验证脚本：启动 server，跑 5 个端点测试，输出结果后退出"""
import subprocess
import sys
import time
import json
import urllib.request

PYTHON = r"C:\Users\HP\.workbuddy\binaries\python\versions\3.13.12\python.exe"
SERVER = r"C:\Users\HP\WorkBuddy\2026-10-10-16-49-04\server.py"
BASE = "http://localhost:4401"

proc = subprocess.Popen([PYTHON, SERVER], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
time.sleep(2)

results = {}

# 1. health
try:
    with urllib.request.urlopen(f"{BASE}/ocp/health") as r:
        results["health"] = json.loads(r.read())
except Exception as e:
    results["health"] = f"ERROR: {e}"

# 2. manifest
try:
    with urllib.request.urlopen(f"{BASE}/ocp/manifest") as r:
        results["manifest_name"] = json.loads(r.read())["catalog_name"]
except Exception as e:
    results["manifest"] = f"ERROR: {e}"

# 3. query 楚辞
try:
    data = json.dumps({"query": "楚辞"}).encode("utf-8")
    req = urllib.request.Request(f"{BASE}/ocp/query", data=data, headers={"content-type": "application/json"})
    with urllib.request.urlopen(req) as r:
        q = json.loads(r.read())
        results["query_楚辞_count"] = q["result_count"]
        titles = [e["entry"]["title"] for e in q["entries"]]
        results["query_楚辞_titles"] = titles
        entry_ids = [e["entry"]["entry_id"] for e in q["entries"]]
        results["query_楚辞_entry_ids"] = entry_ids
except Exception as e:
    results["query"] = f"ERROR: {e}"

# 4. resolve 用 query 返回的第一个 entry_id
try:
    first_id = entry_ids[0]
    data = json.dumps({"entry_id": first_id}).encode("utf-8")
    req = urllib.request.Request(f"{BASE}/ocp/resolve", data=data, headers={"content-type": "application/json"})
    with urllib.request.urlopen(req) as r:
        res = json.loads(r.read())
        results["resolve_id"] = first_id
        results["resolve_title"] = res["title"]
        results["resolve_actions"] = [ab["action_id"] for ab in res["action_bindings"]]
except Exception as e:
    results["resolve"] = f"ERROR: {e}"

# 5. discovery
try:
    with urllib.request.urlopen(f"{BASE}/.well-known/ocp-catalog") as r:
        results["discovery"] = json.loads(r.read())["kind"]
except Exception as e:
        results["discovery"] = f"ERROR: {e}"

proc.terminate()
proc.wait()

print(json.dumps(results, ensure_ascii=False, indent=2))