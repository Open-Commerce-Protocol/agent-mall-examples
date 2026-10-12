#!/bin/zsh
cd "${0:A:h}"
one_ready() {
  curl -fsS http://127.0.0.1:8765/api/health 2>/dev/null | /usr/bin/python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin).get("service")=="agent-mall-one" else 1)' 2>/dev/null
}
if one_ready; then
  open http://127.0.0.1:8765/
  exit 0
fi
python3 app.py &
one_server_pid=$!
trap 'kill "$one_server_pid" 2>/dev/null' INT TERM EXIT
for one_attempt in {1..50}; do
  if one_ready; then
    open http://127.0.0.1:8765/
    break
  fi
  if ! kill -0 "$one_server_pid" 2>/dev/null; then
    printf '启动失败，请查看上面的错误信息。\n'
    read '?按回车关闭…'
    exit 1
  fi
  sleep 0.2
done
wait "$one_server_pid"
