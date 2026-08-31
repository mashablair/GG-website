#!/bin/bash
# End-to-end test of the sign-in flow against the local dev server.
#
# With no email provider configured, the code is printed to the wrangler
# console, so this reads it back from the dev server's log. Point DEV_LOG at
# that log; see test/README.md.
set -uo pipefail

source "$(dirname "$0")/lib.sh"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
pass=0; fail=0

ok()   { echo "  ✅ $1"; pass=$((pass+1)); }
bad()  { echo "  ❌ $1"; fail=$((fail+1)); }
check(){ if [ "$2" = "$3" ]; then ok "$1 ($2)"; else bad "$1 — expected '$3', got '$2'"; fi; }

count() { $DB "$1" 2>/dev/null | grep -oE '"n": [0-9]+' | head -1 | grep -oE '[0-9]+'; }

verify() {  # email code [next]
  curl -s -D "$TMP/h" -o "$TMP/b" -X POST "$BASE/login" \
    --data-urlencode "step=verify" --data-urlencode "email=$1" \
    --data-urlencode "code=$2" ${3:+--data-urlencode "next=$3"}
}

if [ ! -f "$DEV_LOG" ]; then
  echo "  ❌ no dev log at $DEV_LOG — start wrangler with output redirected there"
  exit 1
fi

echo "── Setup ──────────────────────────────────────────"
$DB "DELETE FROM login_codes; DELETE FROM progress; DELETE FROM enrollments; DELETE FROM students;" >/dev/null 2>&1
# Don't assume the new row gets id 1 — AUTOINCREMENT keeps counting after a
# delete, and a wrong student_id trips the foreign key and rolls the lot back.
$DB "INSERT INTO students (email, first_name) VALUES ('student@example.com','Anna');" >/dev/null 2>&1
$DB "INSERT INTO enrollments (student_id, course_slug, provider, external_id)
     SELECT id, 'dating', 'stripe', 'cs_login_test' FROM students WHERE email='student@example.com';" >/dev/null 2>&1
if [ "$(count "SELECT COUNT(*) AS n FROM students WHERE email='student@example.com';")" != "1" ]; then
  echo "  ❌ setup failed — no student row was created"; exit 1
fi
echo "  one student with an active enrollment"

echo
echo "── The form ───────────────────────────────────────"
body=$(curl -s "$BASE/login")
echo "$body" | grep -q 'name="email"'   && ok "asks for an email"      || bad "no email field"
echo "$body" | grep -qi "no password"   && ok "explains there's no password" || bad "no explanation"

echo
echo "── Unknown addresses reveal nothing ───────────────"
known=$(curl -s -X POST "$BASE/login" --data-urlencode "step=request" --data-urlencode "email=student@example.com")
unknown=$(curl -s -X POST "$BASE/login" --data-urlencode "step=request" --data-urlencode "email=nobody@example.com")
k=$(echo "$known"   | grep -c "Six-digit code")
u=$(echo "$unknown" | grep -c "Six-digit code")
check "known address reaches the code form" "$k" "1"
check "unknown address looks identical"     "$u" "1"
echo "$unknown" | grep -qi "not found\|no account\|doesn't exist" && bad "leaks that the account is unknown" || ok "no hint that the account is unknown"
check "no code stored for the unknown address" "$(count "SELECT COUNT(*) AS n FROM login_codes WHERE email='nobody@example.com';")" "0"

echo
echo "── Codes are not stored in the clear ──────────────"
code=$(request_code student@example.com)
[ -n "$code" ] && ok "a code was issued ($code)" || bad "no code found in the log"
stored=$($DB "SELECT code_hash FROM login_codes ORDER BY id DESC LIMIT 1;" 2>/dev/null | grep -oE '"code_hash": "[^"]+"' | sed 's/.*: "//; s/"//')
[ -n "$stored" ] && [ "$stored" != "$code" ] && ok "database holds a hash, not the code" || bad "code stored in the clear"
echo "$stored" | grep -q "$code" && bad "the code appears inside the stored value" || ok "the code is not recoverable from the row"

echo
echo "── Wrong codes ────────────────────────────────────"
verify student@example.com 000000
grep -qi 'set-cookie: idm_session=' "$TMP/h" && bad "wrong code signed us in" || ok "wrong code refused"
grep -q "code didn" "$TMP/b" && ok "says the code didn't work" || bad "no error message"

echo
echo "── The right code ─────────────────────────────────"
code=$(request_code student@example.com)
verify student@example.com "$code"
grep -oE 'HTTP/1.1 [0-9]+' "$TMP/h" | head -1 | grep -q 302 && ok "redirects on success" || bad "no redirect"
grep -qi 'location: /dashboard' "$TMP/h" && ok "lands on her dashboard" || bad "wrong destination"
grep -qi 'set-cookie: idm_session=' "$TMP/h" && ok "session cookie set" || bad "no session cookie"
grep -qi 'httponly' "$TMP/h" && ok "cookie is HttpOnly" || bad "cookie not HttpOnly"

echo
echo "── A code works once ──────────────────────────────"
verify student@example.com "$code"
grep -qi 'set-cookie: idm_session=' "$TMP/h" && bad "the same code worked twice" || ok "reuse refused"

echo
echo "── Guessing is capped ─────────────────────────────"
code=$(request_code student@example.com)
for i in 1 2 3 4 5; do verify student@example.com "00000$i" >/dev/null; done
verify student@example.com "$code"   # correct code, but after 5 wrong tries
grep -qi 'set-cookie: idm_session=' "$TMP/h" && bad "code still worked after 5 wrong guesses" || ok "code burned after 5 wrong guesses"

echo
echo "── Requests are rate limited ──────────────────────"
$DB "DELETE FROM login_codes;" >/dev/null 2>&1
for i in 1 2 3 4 5; do
  curl -s -o /dev/null -X POST "$BASE/login" --data-urlencode "step=request" --data-urlencode "email=student@example.com"
done
before=$(count "SELECT COUNT(*) AS n FROM login_codes WHERE email='student@example.com';")
curl -s -o /dev/null -X POST "$BASE/login" --data-urlencode "step=request" --data-urlencode "email=student@example.com"
after=$(count "SELECT COUNT(*) AS n FROM login_codes WHERE email='student@example.com';")
check "sixth request in an hour issues no code" "$after" "$before"

echo
echo "── Open redirects ─────────────────────────────────"
$DB "DELETE FROM login_codes;" >/dev/null 2>&1
code=$(request_code student@example.com)
verify student@example.com "$code" "https://evil.example.com/steal"
grep -qi 'location: https://evil' "$TMP/h" && bad "redirected off-site" || ok "off-site redirect refused"
grep -qi 'location: /dashboard' "$TMP/h" && ok "fell back to her dashboard" || bad "unexpected destination"

echo
echo "── A browser she's used before ────────────────────"
jar=$TMP/devjar; rm -f "$jar"
sign_in "$jar" student@example.com >/dev/null
grep -q idm_device "$jar" && ok "browser trusted after signing in" || bad "no device token"

# An ordinary sign-out ends the session but keeps the browser trusted.
curl -s -b "$jar" -c "$jar" -o /dev/null "$BASE/logout"
check "session really ended" "$(curl -s -b "$jar" -o /dev/null -w '%{http_code}' "$BASE/learn/dating")" "302"

page=$(curl -s -b "$jar" "$BASE/login")
echo "$page" | grep -q "Welcome back, Anna"     && ok "greets her by name"        || bad "no greeting"
echo "$page" | grep -q "Continue to the course" && ok "offers a one-tap return"   || bad "no one-tap return"
echo "$page" | grep -q "No code needed"         && ok "says no code is needed"    || bad "copy missing"
echo "$page" | grep -q "someone else"           && ok "offers to switch accounts" || bad "no way to switch"

codes_before=$(count_codes)
curl -s -b "$jar" -c "$jar" -o /dev/null -X POST "$BASE/login" --data-urlencode "step=device"
check "one tap gets her back in" "$(curl -s -b "$jar" -o /dev/null -w '%{http_code}' "$BASE/learn/dating")" "200"
check "and sent no email" "$(count_codes)" "$codes_before"

echo
echo "── Sign out everywhere ────────────────────────────"
curl -s -b "$jar" -c "$jar" -o /dev/null "$BASE/logout?everywhere"
check "course locked" "$(curl -s -b "$jar" -o /dev/null -w '%{http_code}' "$BASE/learn/dating")" "302"
page=$(curl -s -b "$jar" "$BASE/login")
echo "$page" | grep -q "Continue to the course" && bad "one-tap survived" || ok "one-tap gone — a code is needed again"
echo "$page" | grep -q 'name="email"' && ok "back to asking for an address" || bad "no email field"
# The trust must not be forgeable
check "a made-up device cookie is refused" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/login" \
     -H 'Cookie: idm_device=eyJwIjoiZGV2aWNlIiwic2lkIjoxfQ.nope' --data-urlencode 'step=device')" "200"


echo
echo "── Signing out ────────────────────────────────────"
curl -s -D "$TMP/h" -o /dev/null "$BASE/logout"
grep -qi 'set-cookie: idm_session=;' "$TMP/h" && ok "cookie cleared" || bad "cookie not cleared"
grep -qi 'max-age=0' "$TMP/h" && ok "cookie expired immediately" || bad "cookie not expired"

echo
echo "═══════════════════════════════════════════════════"
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
