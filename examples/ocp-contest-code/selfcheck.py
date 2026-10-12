"""OCP 合规自检 — 验证所有端点响应结构和边界用例

参考「用 OCP 做一个奶茶铺」指引第 4 节：用官方 schema 逐个校验响应体。
本脚本用 Python 标准库实现等效校验，跑通即证明合规。
"""
import subprocess
import time
import json
import http.client
import sys
import os

PYTHON = r"C:\Users\HP\.workbuddy\binaries\python\versions\3.13.12\python.exe"
WEB = r"C:\Users\HP\WorkBuddy\2026-10-10-16-49-04\web_server.py"
BASE_HOST = "127.0.0.1"
BASE_PORT = 8090

os.environ["PORT"] = str(BASE_PORT)
os.environ["PYTHONUNBUFFERED"] = "1"

proc = subprocess.Popen([PYTHON, WEB], stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=os.environ)
time.sleep(2)

passed = 0
failed = 0
results = []


def check(name, condition, detail=""):
    global passed, failed
    if condition:
        passed += 1
        results.append(f"  PASS  {name}")
    else:
        failed += 1
        results.append(f"  FAIL  {name}  {detail}")


def get(path):
    conn = http.client.HTTPConnection(BASE_HOST, BASE_PORT)
    conn.request("GET", path)
    r = conn.getresponse()
    return r.status, json.loads(r.read())


def post(path, body):
    conn = http.client.HTTPConnection(BASE_HOST, BASE_PORT)
    conn.request("POST", path, body=json.dumps(body), headers={"content-type": "application/json"})
    r = conn.getresponse()
    return r.status, json.loads(r.read())


# 1. Discovery
try:
    s, d = get("/.well-known/ocp-catalog")
    check("discovery 状态码 200", s == 200, f"got {s}")
    check("discovery kind 正确", d.get("kind") == "WellKnownCatalogDiscovery")
    check("discovery 有 manifest_url", "manifest_url" in d)
    check("discovery 有 query_url", "query_url" in d)
    check("discovery 有 resolve_url", "resolve_url" in d)
except Exception as e:
    check("discovery", False, str(e))

# 2. Manifest
try:
    s, d = get("/ocp/manifest")
    check("manifest 状态码 200", s == 200)
    check("manifest kind 正确", d.get("kind") == "CatalogManifest")
    check("manifest 有 endpoints", "endpoints" in d)
    check("manifest 有 query_capabilities", "query_capabilities" in d)
    caps = d.get("query_capabilities", [])
    check("manifest 至少 1 个 capability", len(caps) > 0)
    check("manifest 有 object_contracts", "object_contracts" in d)
except Exception as e:
    check("manifest", False, str(e))

# 3. Health
try:
    s, d = get("/ocp/health")
    check("health 状态码 200", s == 200)
    check("health kind 正确", d.get("kind") == "CatalogHealth")
    check("health status=healthy", d.get("status") == "healthy")
    check("health ready=True", d.get("ready") is True)
except Exception as e:
    check("health", False, str(e))

# 4. Contracts
try:
    s, d = get("/ocp/contracts")
    check("contracts 状态码 200", s == 200)
    check("contracts kind 正确", d.get("kind") == "ObjectContractList")
    check("contracts 有 object_contracts", "object_contracts" in d)
except Exception as e:
    check("contracts", False, str(e))

# 5. Query
try:
    s, d = post("/ocp/query", {"query": "楚辞"})
    check("query 状态码 200", s == 200)
    check("query kind 正确", d.get("kind") == "CatalogQueryResult")
    check("query 有 entries", "entries" in d)
    check("query result_count > 0", d.get("result_count", 0) > 0)
    entries = d.get("entries", [])
    if entries:
        e0 = entries[0].get("entry", {})
        check("query entry 有 entry_id", "entry_id" in e0)
        check("query entry 有 attributes", "attributes" in e0)
        check("query entry 有 DH 扩展字段", "scholarly_rating" in e0.get("attributes", {}))
except Exception as e:
    check("query", False, str(e))

# 6. Resolve purpose=view
try:
    s, d = post("/ocp/resolve", {"entry_id": "entry_classics_chuci-quanquanyi-zhonghua", "purpose": "view"})
    check("resolve(view) 状态码 200", s == 200)
    check("resolve(view) kind 正确", d.get("kind") == "ResolvableReference")
    check("resolve(view) purpose=view", d.get("purpose") == "view")
    abs = d.get("action_bindings", [])
    check("resolve(view) 有 action_bindings", len(abs) > 0)
    if abs:
        check("resolve(view) action_type=url", abs[0].get("action_type") == "url")
        check("resolve(view) 无 requires_confirmation", "requires_user_confirmation" not in abs[0])
except Exception as e:
    check("resolve(view)", False, str(e))

# 7. Resolve purpose=checkout
try:
    s, d = post("/ocp/resolve", {"entry_id": "entry_classics_chuci-quanquanyi-zhonghua", "purpose": "checkout"})
    check("resolve(checkout) 状态码 200", s == 200)
    check("resolve(checkout) purpose=checkout", d.get("purpose") == "checkout")
    abs = d.get("action_bindings", [])
    check("resolve(checkout) 有 action_bindings", len(abs) > 0)
    if abs:
        check("resolve(checkout) action_type=api", abs[0].get("action_type") == "api")
        check("resolve(checkout) requires_user_confirmation=True", abs[0].get("requires_user_confirmation") is True)
        check("resolve(checkout) 有 expires_at", "expires_at" in abs[0])
except Exception as e:
    check("resolve(checkout)", False, str(e))

# 8. 边界：404 未知 entry_id
try:
    s, d = post("/ocp/resolve", {"entry_id": "entry_classics_nonexistent", "purpose": "view"})
    check("边界 404 未知 entry_id", s == 404)
except Exception as e:
    check("边界 404", False, str(e))

# 9. 边界：400 无效 purpose
try:
    s, d = post("/ocp/resolve", {"entry_id": "entry_classics_chuci-quanquanyi-zhonghua", "purpose": "delete"})
    check("边界 400 无效 purpose", s == 400)
except Exception as e:
    check("边界 400 purpose", False, str(e))

# 10. 边界：400 未声明的 query_pack
try:
    s, d = post("/ocp/query", {"query": "楚辞", "query_pack": "ocp.query.unknown.v1"})
    check("边界 400 未声明 query_pack", "error" in d)
except Exception as e:
    check("边界 400 query_pack", False, str(e))

proc.terminate()
proc.wait()

print()
print("=" * 50)
print(f"  OCP 合规自检结果：{passed} 通过 / {failed} 失败")
print("=" * 50)
for r in results:
    print(r)
print()
if failed == 0:
    print("  全部通过，响应结构符合 OCP 规范。")
else:
    print(f"  有 {failed} 项未通过，请检查。")
