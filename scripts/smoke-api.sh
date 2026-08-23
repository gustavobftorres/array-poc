#!/usr/bin/env bash
# Smoke/abuse suite contra o worker local (mock mode). Uso: bash scripts/smoke-api.sh [base]
BASE="${1:-http://localhost:8787}"
pass=0; fail=0
t() { # t <esperado(regex de status)> <label> <curl-args...>
  local exp="$1" label="$2"; shift 2
  local out code
  out=$(curl -s -m 10 -w '\n%{http_code}' "$@")
  code=$(printf '%s' "$out" | tail -1)
  local bodyline; bodyline=$(printf '%s' "$out" | head -c 300 | tr '\n' ' ')
  if [[ "$code" =~ $exp ]]; then pass=$((pass+1)); printf 'OK   [%s] %s\n' "$code" "$label";
  else fail=$((fail+1)); printf 'FAIL [%s exp %s] %s :: %s\n' "$code" "$exp" "$label" "$bodyline"; fi
}
J='Content-Type: application/json'
t '^200$' 'health' "$BASE/api/health"
t '^200$' 'status' "$BASE/api/status"
t '^200$' 'seed' -X POST "$BASE/api/seed"
t '^400$' 'user: body vazio' -X POST -H "$J" -d '{}' "$BASE/api/array/user"
t '^400$' 'user: sem body' -X POST "$BASE/api/array/user"
t '^400$' 'user: JSON quebrado' -X POST -H "$J" -d '{"firstName":' "$BASE/api/array/user"
t '^400$' 'user: ssn curto' -X POST -H "$J" -d '{"firstName":"A","lastName":"B","dob":"1974-04-18","ssn":"123","address":{"street":"1 Main St","city":"Austin","state":"TX","zip":"73301"}}' "$BASE/api/array/user"
t '^400$' 'user: dob futura' -X POST -H "$J" -d '{"firstName":"A","lastName":"B","dob":"2099-01-01","ssn":"666230560","address":{"street":"1 Main St","city":"Austin","state":"TX","zip":"73301"}}' "$BASE/api/array/user"
t '^400$' 'user: dob invalida 2024-13-45' -X POST -H "$J" -d '{"firstName":"A","lastName":"B","dob":"2024-13-45","ssn":"666230560","address":{"street":"1 Main St","city":"Austin","state":"TX","zip":"73301"}}' "$BASE/api/array/user"
t '^400$' 'user: zip invalido' -X POST -H "$J" -d '{"firstName":"A","lastName":"B","dob":"1974-04-18","ssn":"666230560","address":{"street":"1 Main St","city":"Austin","state":"TX","zip":"ABCDE"}}' "$BASE/api/array/user"
t '^40[05]$' 'user: array em vez de objeto' -X POST -H "$J" -d '[1,2,3]' "$BASE/api/array/user"
t '^40[0-9]$|^413$' 'user: payload 2MB' -X POST -H "$J" --data-binary @<(python3 -c 'print("{\"firstName\":\""+"A"*2000000+"\"}")') "$BASE/api/array/user"
t '^40[05]$' 'user: GET sem token' "$BASE/api/array/user"
t '^40[0-9]$|^200$' 'user: GET token inexistente' -H 'x-credmo-user-token: nope' "$BASE/api/array/user"
t '^40[0-9]$' 'authenticate GET sem clientKey' "$BASE/api/array/authenticate"
t '^40[0-9]$' 'authenticate GET clientKey inexistente' "$BASE/api/array/authenticate?clientKey=NAO-EXISTE"
t '^40[0-9]$' 'authenticate POST answers vazio' -X POST -H "$J" -d '{"clientKey":"x","authToken":"y","answers":{}}' "$BASE/api/array/authenticate"
t '^40[0-9]$' 'authenticate POST authToken invalido' -X POST -H "$J" -d '{"clientKey":"x","authToken":"y","answers":{"1":"2"}}' "$BASE/api/array/authenticate"
t '^40[0-9]$' 'usertoken ttl 99999' -X POST -H "$J" -d '{"clientKey":"x","ttlInMinutes":99999}' "$BASE/api/array/usertoken"
t '^40[0-9]$' 'usertoken clientKey inexistente' -X POST -H "$J" -d '{"clientKey":"NAO-EXISTE"}' "$BASE/api/array/usertoken"
t '^40[0-9]$' 'report GET reportKey invalido' "$BASE/api/array/report?reportKey=xxx&displayToken=yyy"
t '^40[0-9]$' 'report GET sem displayToken' "$BASE/api/array/report?reportKey=xxx"
t '^40[0-9]$' 'report POST clientKey inexistente' -X POST -H "$J" -d '{"clientKey":"NAO-EXISTE"}' "$BASE/api/array/report"
t '^40[0-9]$' 'report PUT reportKey invalido' -X PUT -H "$J" -d '{"clientKey":"x","reportKey":"y"}' "$BASE/api/array/report"
t '^40[0-9]$' 'alerts sem clientKey' "$BASE/api/array/alerts"
t '^40[0-9]$' 'alert detail id inexistente' "$BASE/api/array/alerts/9999"
t '^40[0-9]$' 'alert detail path traversal' "$BASE/api/array/alerts/..%2F..%2Fetc%2Fpasswd"
t '^40[0-9]$' 'monitoring sem clientKey' "$BASE/api/array/monitoring"
t '^40[0-9]$' 'scoretracker sem clientKey' "$BASE/api/array/scoretracker"
# --- ciclo 5: W-010 (registro do mock no GET /report) e W-007/W-009 (cache do userToken)
SEED=$(curl -s -X POST "$BASE/api/seed")
read -r CK RK DT <<<"$(printf '%s' "$SEED" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("clientKey",""), d.get("reportKey",""), d.get("displayToken",""))')"
t '^200$' 'W-010 report GET com clientKey valido' "$BASE/api/array/report?reportKey=$RK&displayToken=$DT&clientKey=$CK"
t '^400$' 'W-010 report GET com clientKey inexistente' "$BASE/api/array/report?reportKey=$RK&displayToken=$DT&clientKey=NAO-EXISTE"
t '^200$' 'W-007 usertoken ttl 1440 (nao reaproveita o de 60)' -X POST -H "$J" -d "{\"clientKey\":\"$CK\",\"ttlInMinutes\":1440}" "$BASE/api/array/usertoken"
t '^200$' 'W-009 usertoken ?refresh=1' -X POST -H "$J" -d "{\"clientKey\":\"$CK\"}" "$BASE/api/array/usertoken?refresh=1"
t '^404$' 'rota inexistente' "$BASE/api/array/nope"
t '^40[0-9]$' 'metodo errado (DELETE user)' -X DELETE "$BASE/api/array/user"
t '^200$' 'inspector limit negativo' "$BASE/api/inspector?limit=-5"
t '^200$' 'inspector limit gigante' "$BASE/api/inspector?limit=999999999"
t '^200$' 'inspector limit string' "$BASE/api/inspector?limit=abc"
t '^200$' 'inspector offset negativo' "$BASE/api/inspector?offset=-10"
t '^200$' 'inspector offset gigante' "$BASE/api/inspector?offset=1e30"
echo "---- pass=$pass fail=$fail"
