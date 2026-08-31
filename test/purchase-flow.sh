#!/bin/bash
# End-to-end test of the purchase flow against the local dev server.
set -uo pipefail

BASE=http://127.0.0.1:8788
TMP=$(mktemp -d)
HERE=$(cd "$(dirname "$0")" && pwd)

# Own the stand-in's lifecycle. A mock left running from an earlier run would
# silently serve stale fixtures and the failures would look like product bugs.
lsof -ti :8799 2>/dev/null | xargs -r kill 2>/dev/null
sleep 1
python3 "$HERE/mock-stripe.py" & MOCK_PID=$!
trap 'rm -rf "$TMP"; kill $MOCK_PID 2>/dev/null' EXIT
for _ in $(seq 1 20); do
  curl -sf -o /dev/null http://127.0.0.1:8799/v1/checkout/sessions/cs_test_paid && break
  sleep 0.5
done
SECRET=whsec_local_test_secret
DB="npx --yes wrangler@latest d1 execute dating-goddess-db --local -y --command"
pass=0; fail=0

ok()   { echo "  ✅ $1"; pass=$((pass+1)); }
bad()  { echo "  ❌ $1"; fail=$((fail+1)); }
check(){ if [ "$2" = "$3" ]; then ok "$1 ($2)"; else bad "$1 — expected '$3', got '$2'"; fi; }

# Build a Stripe-style signed webhook request and post it.
post_webhook() {
  local body="$1" ts="${2:-$(date +%s)}"
  local sig
  sig=$(printf '%s' "${ts}.${body}" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/.*= //')
  curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/webhooks/stripe" \
    -H "Content-Type: application/json" \
    -H "Stripe-Signature: t=${ts},v1=${sig}" \
    --data-raw "$body"
}

count() { $DB "$1" 2>/dev/null | grep -oE '"n": [0-9]+' | head -1 | grep -oE '[0-9]+'; }

PAID='{"id":"evt_1","type":"checkout.session.completed","data":{"object":{"id":"cs_test_paid","payment_status":"paid"}}}'
UNPAID='{"id":"evt_2","type":"checkout.session.completed","data":{"object":{"id":"cs_test_unpaid","payment_status":"unpaid"}}}'
REFUND='{"id":"evt_3","type":"charge.refunded","data":{"object":{"id":"ch_1","payment_intent":"pi_test_paid"}}}'

echo "── Reset ──────────────────────────────────────────"
$DB "DELETE FROM progress; DELETE FROM enrollments; DELETE FROM students;" >/dev/null 2>&1
echo "  database cleared"

echo
echo "── Webhook signature ──────────────────────────────"
code=$(post_webhook "$PAID"); check "valid signature accepted" "$code" "200"

code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/webhooks/stripe" \
  -H "Content-Type: application/json" -H "Stripe-Signature: t=$(date +%s),v1=deadbeef" \
  --data-raw "$PAID")
check "forged signature rejected" "$code" "400"

code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/webhooks/stripe" \
  -H "Content-Type: application/json" --data-raw "$PAID")
check "missing signature rejected" "$code" "400"

code=$(post_webhook "$PAID" "$(( $(date +%s) - 4000 ))")
check "stale timestamp rejected (replay)" "$code" "400"

echo
echo "── Account creation ───────────────────────────────"
check "one student created" "$(count 'SELECT COUNT(*) AS n FROM students;')" "1"
check "one enrollment created" "$(count 'SELECT COUNT(*) AS n FROM enrollments;')" "1"
email=$($DB "SELECT email FROM students LIMIT 1;" 2>/dev/null | grep -oE '"email": "[^"]+"' | sed 's/.*: "//; s/"//')
check "email normalised (was '  Buyer@Example.COM ')" "$email" "buyer@example.com"
name=$($DB "SELECT first_name FROM students LIMIT 1;" 2>/dev/null | grep -oE '"first_name": "[^"]+"' | sed 's/.*: "//; s/"//')
check "first name captured" "$name" "Anna"

echo
echo "── Idempotency (webhook retries) ──────────────────"
post_webhook "$PAID" >/dev/null; post_webhook "$PAID" >/dev/null; post_webhook "$PAID" >/dev/null
check "still one enrollment after 3 more deliveries" "$(count 'SELECT COUNT(*) AS n FROM enrollments;')" "1"
check "still one student" "$(count 'SELECT COUNT(*) AS n FROM students;')" "1"

echo
echo "── Unpaid session must not grant access ───────────"
post_webhook "$UNPAID" >/dev/null
check "no enrollment for unpaid session" "$(count 'SELECT COUNT(*) AS n FROM enrollments;')" "1"
check "no student for unpaid session" "$(count 'SELECT COUNT(*) AS n FROM students;')" "1"

echo
echo "── /welcome confirmation page ─────────────────────"
resp=$(curl -s -D "$TMP/h1" "$BASE/welcome?session_id=cs_test_paid")
code=$(grep -oE 'HTTP/1.1 [0-9]+' "$TMP/h1" | head -1 | grep -oE '[0-9]+$')
check "shows a page, not a bare redirect" "$code" "200"
echo "$resp" | grep -q "Payment received"        && ok "confirms the payment"      || bad "no payment confirmation"
echo "$resp" | grep -q "Welcome, Anna"           && ok "greets her by name"        || bad "no personal greeting"
echo "$resp" | grep -q "buyer@example.com"       && ok "shows which email has access" || bad "email not shown"
echo "$resp" | grep -q 'href="/learn/dating"'          && ok "offers a way into the course" || bad "no link to the course"
echo "$resp" | grep -qi "instagram.com/maria"    && ok "shows how to reach a human" || bad "no support contact"
grep -qi 'set-cookie: idm_session=' "$TMP/h1"    && ok "session cookie set"        || bad "no session cookie"
grep -qi 'httponly' "$TMP/h1"                    && ok "cookie is HttpOnly"        || bad "cookie not HttpOnly"

echo
echo "── The welcome link signs you in only once ────────"
resp=$(curl -s -D "$TMP/h2" "$BASE/welcome?session_id=cs_test_paid")
echo "$resp" | grep -q "opened this link before" && ok "second use noted"          || bad "second use not noted"
grep -qi 'set-cookie: idm_session=' "$TMP/h2"    && bad "second use still signed in" || ok "no sign-in on second use"
echo "$resp" | grep -qi "instagram.com/maria"    && ok "still shows support contact" || bad "no support contact"

echo
echo "── Delayed payment (Klarna, bank transfer) ────────"
# Stripe sends `completed` while still unpaid, then `async_payment_succeeded`
# once the money lands. Only the second may grant access.
ASYNC_PENDING='{"id":"evt_a1","type":"checkout.session.completed","data":{"object":{"id":"cs_test_async","payment_status":"unpaid"}}}'
ASYNC_PAID='{"id":"evt_a2","type":"checkout.session.async_payment_succeeded","data":{"object":{"id":"cs_test_async","payment_status":"paid"}}}'
post_webhook "$ASYNC_PENDING" >/dev/null
check "nothing granted while payment is pending" "$(count "SELECT COUNT(*) AS n FROM enrollments WHERE external_id='cs_test_async';")" "0"
post_webhook "$ASYNC_PAID" >/dev/null
check "access granted once the money lands" "$(count "SELECT COUNT(*) AS n FROM enrollments WHERE external_id='cs_test_async';")" "1"

echo
echo "── A consultation must not unlock a course ────────"
# It is recorded, so it shows on her dashboard as something she bought — but it
# must never appear as a course she can open.
coursesBefore=$(count "SELECT COUNT(*) AS n FROM enrollments WHERE course_slug='dating';")
post_webhook '{"id":"evt_c","type":"checkout.session.completed","data":{"object":{"id":"cs_test_consultation_only","payment_status":"paid"}}}' >/dev/null
check "the consultation is recorded" \
  "$(count "SELECT COUNT(*) AS n FROM enrollments WHERE external_id='cs_test_consultation_only' AND course_slug='consult-60';")" "1"
check "but it unlocked no course" \
  "$(count "SELECT COUNT(*) AS n FROM enrollments WHERE course_slug='dating';")" "$coursesBefore"

echo
echo "── Cross-sell basket ──────────────────────────────"
# One checkout, two products. Both must be recorded: keyed on the transaction
# alone the second would be silently dropped and she'd be missing something she
# paid for.
curl -s -o /dev/null "$BASE/welcome?session_id=cs_test_crosssell"
check "both items recorded from one checkout" \
  "$(count "SELECT COUNT(*) AS n FROM enrollments WHERE external_id='cs_test_crosssell';")" "2"
check "the course from the basket" \
  "$(count "SELECT COUNT(*) AS n FROM enrollments WHERE external_id='cs_test_crosssell' AND course_slug='dating';")" "1"
check "the consultation from the basket" \
  "$(count "SELECT COUNT(*) AS n FROM enrollments WHERE external_id='cs_test_crosssell' AND course_slug='consult-60';")" "1"

# Re-delivering that basket must still change nothing — idempotency now has to
# hold per product, not just per transaction.
curl -s -o /dev/null "$BASE/welcome?session_id=cs_test_crosssell"
post_webhook '{"id":"evt_x","type":"checkout.session.completed","data":{"object":{"id":"cs_test_crosssell","payment_status":"paid"}}}' >/dev/null
check "still two after a retry" \
  "$(count "SELECT COUNT(*) AS n FROM enrollments WHERE external_id='cs_test_crosssell';")" "2"

echo
echo "── Unknown session ────────────────────────────────"
body=$(curl -s "$BASE/welcome?session_id=cs_does_not_exist")
echo "$body" | grep -q "couldn't confirm" && ok "unknown session refused" || bad "unknown session not refused"

echo
echo "── Refund revokes access ──────────────────────────"
post_webhook "$REFUND" >/dev/null
status=$($DB "SELECT status FROM enrollments LIMIT 1;" 2>/dev/null | grep -oE '"status": "[^"]+"' | sed 's/.*: "//; s/"//')
check "enrollment marked refunded" "$status" "refunded"

echo
echo "═══════════════════════════════════════════════════"
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
