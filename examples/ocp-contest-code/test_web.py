"""测试 Web 产品版"""
import subprocess
import time
import json
import urllib.request

PYTHON = r"C:\Users\HP\.workbuddy\binaries\python\versions\3.13.12\python.exe"
WEB = r"C:\Users\HP\WorkBuddy\2026-10-10-16-49-04\web_server.py"
BASE = "http://localhost:4401"

proc = subprocess.Popen([PYTHON, WEB], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
time.sleep(2)

results = {}

# 1. 首页 HTML
try:
    with urllib.request.urlopen(f"{BASE}/") as r:
        html = r.read().decode("utf-8")
        results["homepage"] = "OK" if "校雠" in html else "MISSING_TITLE"
except Exception as e:
    results["homepage"] = f"ERROR: {e}"

# 2. OCP health
try:
    with urllib.request.urlopen(f"{BASE}/ocp/health") as r:
        results["ocp_health"] = json.loads(r.read())["status"]
except Exception as e:
    results["ocp_health"] = f"ERROR: {e}"

# 3. Agent API
try:
    data = json.dumps({"message": "帮我选本楚辞给初中孩子读"}).encode("utf-8")
    req = urllib.request.Request(f"{BASE}/api/agent", data=data, headers={"content-type": "application/json"})
    with urllib.request.urlopen(req) as r:
        resp = json.loads(r.read())
        results["agent_ok"] = resp.get("ok")
        results["agent_work"] = resp.get("intent", {}).get("work")
        results["agent_audience"] = resp.get("intent", {}).get("audience")
        results["agent_discovery"] = resp.get("discovery_count")
        results["agent_qualified"] = resp.get("qualified_count")
        results["agent_deal_title"] = resp.get("deal", {}).get("title")
        results["agent_deal_price"] = resp.get("deal", {}).get("price")
        results["agent_annotation"] = "有" if resp.get("annotation") else "无"
except Exception as e:
    results["agent"] = f"ERROR: {e}"

# 4. Purchase API
try:
    entry_id = results.get("agent_deal_title", "")
    # 先拿 entry_id
    data = json.dumps({"message": "帮我选本楚辞给初中孩子读"}).encode("utf-8")
    req = urllib.request.Request(f"{BASE}/api/agent", data=data, headers={"content-type": "application/json"})
    with urllib.request.urlopen(req) as r:
        resp = json.loads(r.read())
        eid = resp["deal"]["entry_id"]

    pdata = json.dumps({"entry_id": eid}).encode("utf-8")
    preq = urllib.request.Request(f"{BASE}/api/purchase", data=pdata, headers={"content-type": "application/json"})
    with urllib.request.urlopen(preq) as r:
        presp = json.loads(r.read())
        results["purchase_ok"] = presp.get("ok")
        results["purchase_tx_id"] = presp.get("transaction_id")
        results["purchase_msg"] = presp.get("message")
except Exception as e:
    results["purchase"] = f"ERROR: {e}"

proc.terminate()
proc.wait()

print(json.dumps(results, ensure_ascii=False, indent=2))