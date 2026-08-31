#!/bin/bash
# The Lava.top purchase path, end to end, against a local stand-in for their API.
set -uo pipefail

source "$(dirname "$0")/lib.sh"
TMP=$(mktemp -d)
HERE=$(cd "$(dirname "$0")" && pwd)

lsof -ti :8797 2>/dev/null | xargs -r kill 2>/dev/null
sleep 1
python3 "$HERE/mock-lava.py" & MOCK_PID=$!
trap 'rm -rf "$TMP"; kill $MOCK_PID 2>/dev/null' EXIT
for _ in $(seq 1 20); do
  curl -sf -o /dev/null -H "X-Api-Key: lava_test_api_key" \
    http://127.0.0.1:8797/api/v1/invoices/c0000000-0000-0000-0000-000000000001 && break
  sleep 0.5
done

SECRET=lava_test_webhook_secret
pass=0; fail=0
ok()   { echo "  ✅ $1"; pass=$((pass+1)); }
bad()  { echo "  ❌ $1"; fail=$((fail+1)); }
check(){ if [ "$2" = "$3" ]; then ok "$1 ($2)"; else bad "$1 — expected '$3', got '$2'"; fi; }
count(){ $DB "$1" 2>/dev/null | grep -oE '"n": [0-9]+' | head -1 | grep -oE '[0-9]+'; }

post() {  # body [authHeader...]
  local body="$1"; shift
  curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/webhooks/lava" \
    -H "Content-Type: application/json" "$@" --data-raw "$body"
}
post_ok() { post "$1" -H "X-Api-Key: $SECRET"; }

PAID='{"eventType":"payment.success","product":{"id":"c7507de8-f478-4e3d-9910-7e424e6e8231","title":"The Method"},"buyer":{"email":"Olga@Example.RU "},"contractId":"c0000000-0000-0000-0000-000000000001","amount":24700,"currency":"RUB","status":"completed","errorMessage":""}'
PENDING='{"eventType":"payment.success","product":{"id":"c7507de8-f478-4e3d-9910-7e424e6e8231"},"buyer":{"email":"pending@example.ru"},"contractId":"c0000000-0000-0000-0000-000000000002","amount":24700,"currency":"RUB","status":"completed"}'
MISMATCH='{"eventType":"payment.success","product":{"id":"c7507de8-f478-4e3d-9910-7e424e6e8231"},"buyer":{"email":"attacker@example.com"},"contractId":"c0000000-0000-0000-0000-000000000003","amount":24700,"currency":"RUB","status":"completed"}'
INVENTED='{"eventType":"payment.success","product":{"id":"c7507de8-f478-4e3d-9910-7e424e6e8231"},"buyer":{"email":"nobody@example.com"},"contractId":"c0000000-0000-0000-0000-0000000000ff","amount":24700,"currency":"RUB","status":"completed"}'
OTHERPROD='{"eventType":"payment.success","product":{"id":"lava-prod-consultation"},"buyer":{"email":"olga@example.ru"},"contractId":"c0000000-0000-0000-0000-000000000001","amount":9700,"currency":"RUB","status":"completed"}'
FAILED='{"eventType":"payment.failed","product":{"id":"c7507de8-f478-4e3d-9910-7e424e6e8231"},"buyer":{"email":"olga@example.ru"},"contractId":"c0000000-0000-0000-0000-000000000001","amount":24700,"currency":"RUB","status":"failed"}'
REFUND='{"event_id":"r1","event_type":"refund.success","created_at":"2026-08-29T09:38:27Z","data":{"refund_id":"r1","refund_type":"full","amount":24700,"currency":"RUB","product":{"product_name":"The Method","product_id":"c7507de8-f478-4e3d-9910-7e424e6e8231"},"customer_email":"olga@example.ru"}}'

echo "── Reset ──────────────────────────────────────────"
$DB "DELETE FROM progress; DELETE FROM enrollments; DELETE FROM students; DELETE FROM login_codes;" >/dev/null 2>&1
echo "  database cleared"

echo
echo "── Credentials ────────────────────────────────────"
check "no credentials rejected"        "$(post "$PAID")" "401"
check "wrong api key rejected"         "$(post "$PAID" -H 'X-Api-Key: not-the-secret')" "401"
check "wrong basic auth rejected"      "$(post "$PAID" -H "Authorization: Basic $(printf 'a:b' | base64)")" "401"
check "correct api key accepted"       "$(post_ok "$PAID")" "200"
# Lava may be configured with either scheme, so both must work.
$DB "DELETE FROM enrollments; DELETE FROM students;" >/dev/null 2>&1
check "correct basic auth accepted"    "$(post "$PAID" -H "Authorization: Basic $(printf '%s' "$SECRET" | base64)")" "200"

echo
echo "── A genuine purchase ─────────────────────────────"
check "one student"    "$(count 'SELECT COUNT(*) AS n FROM students;')" "1"
check "one enrollment" "$(count 'SELECT COUNT(*) AS n FROM enrollments;')" "1"
email=$($DB "SELECT email FROM students LIMIT 1;" 2>/dev/null | grep -oE '"email": "[^"]+"' | sed 's/.*: "//; s/"//')
check "email normalised (was ' Olga@Example.RU ')" "$email" "olga@example.ru"
prov=$($DB "SELECT provider FROM enrollments LIMIT 1;" 2>/dev/null | grep -oE '"provider": "[^"]+"' | sed 's/.*: "//; s/"//')
check "recorded against lava" "$prov" "lava"
cur=$($DB "SELECT currency FROM enrollments LIMIT 1;" 2>/dev/null | grep -oE '"currency": "[^"]+"' | sed 's/.*: "//; s/"//')
check "currency kept as roubles" "$cur" "rub"
amt=$($DB "SELECT amount_cents FROM enrollments LIMIT 1;" 2>/dev/null | grep -oE '"amount_cents": [0-9]+' | grep -oE '[0-9]+')
check "amount in the smallest unit" "$amt" "2470000"

echo
echo "── Retries change nothing ─────────────────────────"
post_ok "$PAID" >/dev/null; post_ok "$PAID" >/dev/null; post_ok "$PAID" >/dev/null
check "still one enrollment after 3 more deliveries" "$(count 'SELECT COUNT(*) AS n FROM enrollments;')" "1"

echo
echo "── Lava's own record has the final say ────────────"
before=$(count 'SELECT COUNT(*) AS n FROM enrollments;')
check "unsettled contract grants nothing"  "$(post_ok "$PENDING")"  "200"
check "  — and wrote nothing"              "$(count 'SELECT COUNT(*) AS n FROM enrollments;')" "$before"
# The strongest case: valid credentials, a real completed contract, but the
# webhook claims a different buyer. Without the email check this would hand the
# course to whoever posted it.
check "buyer mismatch grants nothing"      "$(post_ok "$MISMATCH")" "200"
check "  — and wrote nothing"              "$(count 'SELECT COUNT(*) AS n FROM enrollments;')" "$before"
check "invented contract grants nothing"   "$(post_ok "$INVENTED")" "200"
check "  — and wrote nothing"              "$(count 'SELECT COUNT(*) AS n FROM enrollments;')" "$before"

echo
echo "── Only real courses unlock ───────────────────────"
check "an unmapped product grants nothing" "$(post_ok "$OTHERPROD")" "200"
check "  — and wrote nothing"              "$(count 'SELECT COUNT(*) AS n FROM enrollments;')" "$before"

echo
echo "── Uninteresting events are acknowledged ──────────"
check "failed payment answered 200, not retried forever" "$(post_ok "$FAILED")" "200"
check "  — and wrote nothing" "$(count 'SELECT COUNT(*) AS n FROM enrollments;')" "$before"

echo
echo "── Refunds ────────────────────────────────────────"
check "refund accepted" "$(post_ok "$REFUND")" "200"
status=$($DB "SELECT status FROM enrollments LIMIT 1;" 2>/dev/null | grep -oE '"status": "[^"]+"' | sed 's/.*: "//; s/"//')
check "access revoked by buyer, not contract id" "$status" "refunded"

echo
echo "── Buying: the form ───────────────────────────────"
page=$(curl -s "$BASE/pay/lava")
grep -q "Оплата в рублях" <<< "$page" && ok "the page is in Russian"        || bad "not in Russian"
grep -q "Оплатить картой"     <<< "$page" && ok "offers card"     || bad "no card button"
grep -q "Оплатить через СБП"  <<< "$page" && ok "offers SBP"      || bad "no SBP button"
grep -q "на английском"   <<< "$page" && ok "says the course is in English" || bad "language not disclosed"
grep -q 'name="email"'    <<< "$page" && ok "asks for an email"             || bad "no email field"

echo
echo "── Buying: bad input ──────────────────────────────"
bad_email=$(curl -s -X POST "$BASE/pay/lava" --data-urlencode "email=not-an-email")
grep -q "опечатка" <<< "$bad_email" && ok "a malformed address is refused" || bad "malformed address accepted"

echo
echo "── Buying: an address Lava won't sell to ──────────"
# Lava answers 400 "Incorrect email to purchase" for the seller's own address.
# Waiting a minute and retrying gets the same answer, so the page has to say
# what to change.
refused=$(curl -s -X POST "$BASE/pay/lava" --data-urlencode "email=seller@example.ru")
grep -q "не принимает этот адрес" <<< "$refused" && ok "names the email as the problem" || bad "wrong message for a refused address"
grep -q "Попробуйте другой email" <<< "$refused" && ok "says what to do about it"     || bad "no remedy offered"
grep -q "через минуту" <<< "$refused" && bad "still tells her to wait and retry"      || ok "doesn't send her round a loop"

echo
echo "── Buying: creating the invoice ───────────────────"
hdrs=$(curl -s -D - -o /dev/null -X POST "$BASE/pay/lava" --data-urlencode "email=olga@example.ru")
code=$(grep -oE "HTTP/1.1 [0-9]+" <<< "$hdrs" | head -1 | grep -oE "[0-9]+$")
check "redirects to the payment widget" "$code" "302"
grep -qi "location: https://payment-widget" <<< "$hdrs" && ok "sends her to Lava's widget" || bad "wrong destination"
grep -qi "set-cookie: idm_pending=" <<< "$hdrs" && ok "remembers the contract in a signed cookie" || bad "no pending cookie"
grep -qi "httponly" <<< "$hdrs" && ok "that cookie is HttpOnly" || bad "pending cookie not HttpOnly"
# Save the cookie for the return trip.
curl -s -c "$TMP/pay" -o /dev/null -X POST "$BASE/pay/lava" --data-urlencode "email=olga@example.ru"

echo
echo "── Buying: choosing СБП ───────────────────────────"
# СБП is a different provider, and the provider is fixed when the invoice is
# made — so pressing the СБП button has to reach Lava as PAY2ME/SBP, not as a
# card. The stand-in refuses the pairing if only one of the two is sent.
sbp=$(curl -s -D - -o /dev/null -X POST "$BASE/pay/lava" \
  --data-urlencode "email=olga@example.ru" --data-urlencode "method=sbp")
grep -qi "location: https://pay2me-widget" <<< "$sbp" && ok "sends her to Pay2Me, not the card widget" || bad "SBP went to the wrong provider"
# The card button, and anything unrecognised, must still take the default path.
card=$(curl -s -D - -o /dev/null -X POST "$BASE/pay/lava" \
  --data-urlencode "email=olga@example.ru" --data-urlencode "method=card")
grep -qi "location: https://payment-widget" <<< "$card" && ok "card stays on the default provider" || bad "card went somewhere unexpected"
junk=$(curl -s -D - -o /dev/null -X POST "$BASE/pay/lava" \
  --data-urlencode "email=olga@example.ru" --data-urlencode "method=nonsense")
grep -qi "location: https://payment-widget" <<< "$junk" && ok "an unknown method falls back to card" || bad "unknown method not handled"

echo
echo "── Coming back before the bank settles ────────────"
before=$(count 'SELECT COUNT(*) AS n FROM enrollments;')
page=$(curl -s -b "$TMP/pay" "$BASE/pay/complete")
grep -q "обрабатывается" <<< "$page" && ok "says the payment is still processing" || bad "wrong message"
grep -q "Повторно платить не нужно" <<< "$page" && ok "tells her not to pay twice" || bad "no reassurance"
check "nothing granted yet" "$(count 'SELECT COUNT(*) AS n FROM enrollments;')" "$before"

echo
echo "── Coming back after it settles ───────────────────"
curl -s -o /dev/null "http://127.0.0.1:8797/_settle?contract=c0000000-0000-0000-0000-0000000000aa"
hdrs=$(curl -s -D - -o "$TMP/done" -b "$TMP/pay" "$BASE/pay/complete")
grep -q "Оплата получена" "$TMP/done" && ok "confirms the payment"          || bad "no confirmation"
grep -q "olga@example.ru" "$TMP/done" && ok "shows which email has access"  || bad "email not shown"
grep -qi "set-cookie: idm_session=" <<< "$hdrs" && ok "signs her in"        || bad "not signed in"
grep -qi "set-cookie: idm_pending=;" <<< "$hdrs" && ok "clears the pending cookie" || bad "pending cookie left behind"
check "enrollment created" "$(count "SELECT COUNT(*) AS n FROM enrollments WHERE external_id='c0000000-0000-0000-0000-0000000000aa';")" "1"

echo
echo "── The return link works once ─────────────────────"
page=$(curl -s -b "$TMP/pay" "$BASE/pay/complete")
grep -q "уже открывалась" <<< "$page" && ok "second use noted" || bad "second use not noted"

echo
echo "── Both providers coexist ─────────────────────────"
# The same id under a different provider must not collide.
before=$(count 'SELECT COUNT(*) AS n FROM enrollments;')
$DB "INSERT INTO enrollments (student_id, course_slug, provider, external_id, currency)
     SELECT id,'dating','stripe','c0000000-0000-0000-0000-000000000001','usd' FROM students LIMIT 1;" >/dev/null 2>&1
check "stripe and lava can share an external id" "$(count 'SELECT COUNT(*) AS n FROM enrollments;')" "$((before + 1))"

echo
echo "═══════════════════════════════════════════════════"
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
