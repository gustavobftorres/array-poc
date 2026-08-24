# 0) segredos e chaves ficam no SHELL, não no snippet:
#      export ARRAY_CLIENT_TOKEN='...'   # SEGREDO de servidor: nunca no browser
#      export ARRAY_APP_KEY='...'        # público por design (36 caracteres)
#      export REPORT_KEY='...' DISPLAY_TOKEN='...'   # do passo 5

# o relatório pode voltar vazio por alguns segundos: espere, não desista.
# ATENÇÃO: esperar só faz sentido para 2xx vazio. Um 401/403/404 não melhora
# com o tempo — aborte e mostre o corpo, senão você depura "relatório lento"
# quando o problema é credencial (Y-002).
for tentativa in 1 2 3 4 5 6 7 8 9 10; do
  resposta=$(curl -sS -G -w '\n%{http_code}' http://127.0.0.1:8931/api/report/v2 \
    --data-urlencode "reportKey=B" \
    --data-urlencode "displayToken=$DISPLAY_TOKEN")
  status=$(printf '%s' "$resposta" | tail -n1)
  corpo=$(printf '%s' "$resposta" | sed '$d')
  if [ "$status" != "200" ]; then
    echo "HTTP $status na tentativa $tentativa — abortando (não é relatório vazio):" >&2
    printf '%s\n' "$corpo" >&2
    exit 1
  fi
  # "populado" aqui = corpo que não é vazio nem {} — ver o selo // UNVERIFIED
  if [ -n "$corpo" ] && [ "$(printf '%s' "$corpo" | tr -d ' \n\t')" != "{}" ]; then
    printf '%s\n' "$corpo"
    break
  fi
  echo "HTTP 200 vazio na tentativa $tentativa — esperando 3 s" >&2
  sleep 3
done

# displayToken expirado? renove sem pedir outro relatório:
curl -sS -X PUT http://127.0.0.1:8931/api/report/v2 \
  -H "content-type: application/json" \
  -H "x-credmo-client-token: $ARRAY_CLIENT_TOKEN" \
  -d @- <<JSON
{ "clientKey": "$CLIENT_KEY", "reportKey": "B" }
JSON
# -> { "displayToken": "novo..." }