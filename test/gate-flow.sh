#!/bin/bash
# Checks that a course is closed to everyone without a paid, signed-in account —
# and open to everyone with one.
#
# Since the platform holds more than one product, it also checks the thing that
# matters most once that's true: access is granted per product. Owning one thing
# must never unlock another.
set -uo pipefail

source "$(dirname "$0")/lib.sh"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
pass=0; fail=0

ok()   { echo "  ✅ $1"; pass=$((pass+1)); }
bad()  { echo "  ❌ $1"; fail=$((fail+1)); }
check(){ if [ "$2" = "$3" ]; then ok "$1 ($2)"; else bad "$1 — expected '$3', got '$2'"; fi; }
count(){ $DB "$1" 2>/dev/null | grep -oE '"n": [0-9]+' | head -1 | grep -oE '[0-9]+'; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

COURSE=/learn/dating

echo "── Setup ──────────────────────────────────────────"
$DB "DELETE FROM login_codes; DELETE FROM progress; DELETE FROM enrollments; DELETE FROM students;" >/dev/null 2>&1
$DB "INSERT INTO students (email, first_name) VALUES ('gated@example.com','Anna');" >/dev/null 2>&1
$DB "INSERT INTO enrollments (student_id, course_slug, provider, external_id)
     SELECT id,'dating','stripe','cs_gate_test' FROM students WHERE email='gated@example.com';" >/dev/null 2>&1
[ "$(count "SELECT COUNT(*) AS n FROM students;")" = "1" ] || { echo "  ❌ setup failed"; exit 1; }
echo "  one student with an active enrollment in 'dating'"

echo
echo "── Signed out: the course is closed ───────────────"
for p in $COURSE $COURSE/intro/welcome $COURSE/resources $COURSE/safety /dashboard; do
  check "$p redirects to sign in" "$(code "$BASE$p")" "302"
done
loc=$(curl -s -D - -o /dev/null "$BASE$COURSE/flags/red-flags" | grep -i '^location:' | tr -d '\r')
echo "$loc" | grep -q '/login' && ok "sent to /login" || bad "not sent to /login"
echo "$loc" | grep -q 'next=%2Flearn%2Fdating%2Fflags%2Fred-flags' \
  && ok "remembers where she was going" || bad "loses the destination"

echo
echo "── The rest of the site stays open ────────────────"
for p in / /login /welcome /api/health /404.html; do
  c=$(code "$BASE$p"); [ "$c" = "302" ] && bad "$p was gated" || ok "$p still reachable ($c)"
done

echo
echo "── Signed in with a paid account ──────────────────"
sign_in "$TMP/jar" gated@example.com && ok "signed in" || bad "could not sign in"

for p in $COURSE $COURSE/intro/welcome $COURSE/resources /dashboard; do
  check "$p opens" "$(code -b "$TMP/jar" "$BASE$p")" "200"
done
home=$(curl -s -b "$TMP/jar" "$BASE$COURSE")
grep -q "lessons complete" <<< "$home" && ok "the course home renders" || bad "course home did not render"

dash=$(curl -s -b "$TMP/jar" "$BASE/dashboard")
grep -q "The Dating Method" <<< "$dash" && ok "her dashboard lists the course she owns" || bad "dashboard missing her course"
grep -q "Welcome back" <<< "$dash" && ok "dashboard greets her" || bad "dashboard has no greeting"

echo
echo "── One purchase unlocks one thing ─────────────────"
# The whole point of a catalog: a slug that isn't a course has nothing to open,
# and a course she hasn't bought stays shut.
check "a service has nothing to open" "$(code -b "$TMP/jar" "$BASE/learn/consult-60")" "404"
check "an unknown course is not found"  "$(code -b "$TMP/jar" "$BASE/learn/nope")"       "404"
check "/learn on its own goes to her dashboard" "$(code -b "$TMP/jar" "$BASE/learn")" "302"

# Swap her enrollment for a *different* product and the course must shut, even
# though she is still signed in and still has an active purchase.
$DB "UPDATE enrollments SET course_slug='consult-60';" >/dev/null 2>&1
check "owning something else does not unlock the course" \
  "$(code -b "$TMP/jar" "$BASE$COURSE")" "403"
other=$(curl -s -b "$TMP/jar" "$BASE$COURSE")
grep -q "isn't on your account" <<< "$other" && ok "says which course is missing" || bad "unclear message"
dash=$(curl -s -b "$TMP/jar" "$BASE/dashboard")
grep -q "Consultation" <<< "$dash" && ok "the consultation still shows on her dashboard" || bad "consultation missing"
$DB "UPDATE enrollments SET course_slug='dating';" >/dev/null 2>&1

echo
echo "── Getting around the site ────────────────────────"
for p in $COURSE $COURSE/intro/welcome $COURSE/resources /account /dashboard; do
  page=$(curl -s -b "$TMP/jar" "$BASE$p")
  echo "$page" | grep -q 'href="/logout"' && ok "$p offers sign out" || bad "$p has no sign out"
done
# The header row is hidden below 900px, so the drawer must carry the same links
# or a phone has no way to reach them at all.
for p in $COURSE $COURSE/intro/welcome /account /dashboard; do
  # A herestring, not a pipe: `grep -q` exits on the first match and closes the
  # pipe, which kills `echo` with SIGPIPE and makes the check look like a fail.
  page=$(curl -s -b "$TMP/jar" "$BASE$p")
  grep -q 'app-rail__nav' <<< "$page" \
    && ok "$p has the links in the mobile drawer" || bad "$p unreachable on a phone"
done
signin=$(curl -s "$BASE/login")
grep -q 'href="/logout"' <<< "$signin" && bad "sign-in page shows course nav" || ok "signed-out pages stay clean"

echo
echo "── A forged cookie is refused ─────────────────────"
check "tampered session rejected" \
  "$(code -H 'Cookie: idm_session=eyJzaWQiOjF9.notarealsignature' "$BASE$COURSE")" "302"

echo
echo "── After a refund ─────────────────────────────────"
$DB "UPDATE enrollments SET status='refunded';" >/dev/null 2>&1
check "refunded student is blocked" "$(code -b "$TMP/jar" "$BASE$COURSE")" "403"
denied=$(curl -s -b "$TMP/jar" "$BASE$COURSE")
grep -q "isn't on your account" <<< "$denied" && ok "explains why, not a bare error" || bad "unhelpful error page"
grep -qi "instagram" <<< "$denied" && ok "offers a way to get help" || bad "no way to get help"
# She can still reach her own dashboard to see what happened.
check "dashboard still hers after a refund" "$(code -b "$TMP/jar" "$BASE/dashboard")" "200"
$DB "UPDATE enrollments SET status='active';" >/dev/null 2>&1

echo
echo "── After signing out ──────────────────────────────"
curl -s -c "$TMP/jar" -o /dev/null "$BASE/logout"
check "course closed again" "$(code -b "$TMP/jar" "$BASE$COURSE")" "302"

echo
echo "═══════════════════════════════════════════════════"
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
