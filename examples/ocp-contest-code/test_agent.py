"""非交互式测试 agent.py 的完整流程"""
import subprocess
import sys

PYTHON = r"C:\Users\HP\.workbuddy\binaries\python\versions\3.13.12\python.exe"
AGENT = r"C:\Users\HP\WorkBuddy\2026-10-10-16-49-04\agent.py"

# 先启动 server
import time
server_proc = subprocess.Popen(
    [PYTHON, r"C:\Users\HP\WorkBuddy\2026-10-10-16-49-04\server.py"],
    stdout=subprocess.PIPE, stderr=subprocess.PIPE
)
time.sleep(2)

# 测试场景
test_inputs = [
    "帮我选本楚辞给初中孩子读",
    "我想买论语，预算50以内，大学用",
    "诗经选一本学术研究的",
    "字帖入门选哪个",
    "多宝塔碑进阶临摹",
    "曹全碑专业收藏",
    "庄子给大学生",
    "q"
]

stdin_data = "\n".join(test_inputs) + "\n"
result = subprocess.run(
    [PYTHON, AGENT],
    input=stdin_data,
    capture_output=True,
    text=True,
    encoding="utf-8",
    timeout=30
)

server_proc.terminate()
server_proc.wait()

print(result.stdout)
if result.stderr:
    print("STDERR:", result.stderr)