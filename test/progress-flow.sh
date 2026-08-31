#!/bin/bash
# Progress and the account page, for a signed-in student.
set -uo pipefail

source "$(dirname "$0")/lib.sh"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
pass=0; fail=0

ok()   { echo "  ✅ $1"; pass=$((pass+1)); }
bad()  { echo "  ❌ $1"; fail=$((fail+1)); }
check(){ if [ "$2" = "$3" ]; then ok "$1 ($2)"; else bad "$1 — expected '$3', got '$2'"; fi; }
count(){ $DB "$1" 2>/dev/null | grep -oE '"n": [0-9]+' | head -1 | grep -oE '[0-9]+'; }
get()  { curl -s -b "$TMP/jar" "$BASE$1"; }
# Same reasoning as page_has in lib.sh: never pipe a page into `grep -q`.
has()  { local body; body=$(get "$1"); grep -q "$2" <<< "$body"; }

mark() {  # lesson done next
  curl -s -b "$TMP/jar" -o /dev/null -X POST "$BASE/api/progress" \
    --data-urlencode "course=dating" \
    --data-urlencode "lesson=$1" --data-urlencode "done=$2" --data-urlencode "next=${3:-/learn/dating}"
}

echo "── Setup ──────────────────────────────────────────"
$DB "DELETE FROM login_codes; DELETE FROM progress; DELETE FROM enrollments; DELETE FROM students;" >/dev/null 2>&1
$DB "INSERT INTO students (email, first_name) VALUES ('prog@example.com','Anna');" >/dev/null 2>&1
$DB "INSERT INTO enrollments (student_id, course_slug, provider, external_id, amount_cents)
     SELECT id,'dating','stripe','cs_prog_test',24700 FROM students WHERE email='prog@example.com';" >/dev/null 2>&1
sign_in "$TMP/jar" prog@example.com && echo "  signed in" || { echo "  ❌ could not sign in"; exit 1; }

echo
echo "── Starting from nothing ──────────────────────────"
has /learn/dating "<strong>0</strong> of 35" && ok "dashboard shows 0 of 35" || bad "wrong starting count"
has /learn/dating "Start the course" && ok "invites her to start" || bad "wrong call to action"

echo
echo "── Marking a lesson complete ──────────────────────"
mark "intro/welcome" 1 "/learn/dating/intro/how-to-use-this-course"
check "row written to the database" "$(count "SELECT COUNT(*) AS n FROM progress WHERE lesson_id='intro/welcome';")" "1"
has /learn/dating "<strong>1</strong> of 35" && ok "dashboard counts it" || bad "dashboard did not update"
has /learn/dating/intro/how-to-use-this-course 'is-done' && ok "sidebar shows a checkmark" || bad "no checkmark in the sidebar"
has /learn/dating "Continue where you left off" && ok "offers to continue" || bad "no continue prompt"

echo
echo "── It survives a new browser ──────────────────────"
# A second sign-in from a clean cookie jar — the same student, no shared state
sign_in "$TMP/jar2" prog@example.com >/dev/null
other=$(curl -s -b "$TMP/jar2" "$BASE/learn/dating")
grep -q "<strong>1</strong> of 35" <<< "$other" \
  && ok "progress follows her to another device" || bad "progress did not follow"

echo
echo "── Out-of-order completion ────────────────────────"
mark "on-a-date/conversation" 1
mark "magnetic-profile/your-bio" 1
check "three lessons complete" "$(count 'SELECT COUNT(*) AS n FROM progress;')" "3"
has /learn/dating "<strong>3</strong> of 35" && ok "counted regardless of order" || bad "miscounted"
# The count sits on the line after the tag, so match across lines
dash=$(get /learn/dating)
grep -A2 'module-card__done' <<< "$dash" | grep -q '1/4' && ok "module 5 shows 1 of 4" || bad "module count wrong"

echo
echo "── Unmarking ──────────────────────────────────────"
mark "intro/welcome" 0
check "row removed" "$(count "SELECT COUNT(*) AS n FROM progress WHERE lesson_id='intro/welcome';")" "0"
has /learn/dating "<strong>2</strong> of 35" && ok "count drops back" || bad "count did not drop"

echo
echo "── Marking the same lesson twice ──────────────────"
mark "on-a-date/conversation" 1
check "still one row, no duplicate" "$(count "SELECT COUNT(*) AS n FROM progress WHERE lesson_id='on-a-date/conversation';")" "1"

echo
echo "── Rubbish is refused ─────────────────────────────"
c=$(curl -s -b "$TMP/jar" -o /dev/null -w '%{http_code}' -X POST "$BASE/api/progress" \
     --data-urlencode "course=dating" \
     --data-urlencode "lesson=nonsense/not-a-lesson" --data-urlencode "done=1")
check "unknown lesson rejected" "$c" "400"
check "nothing written" "$(count "SELECT COUNT(*) AS n FROM progress WHERE lesson_id='nonsense/not-a-lesson';")" "0"

c=$(curl -s -b "$TMP/jar" -o /dev/null -w '%{http_code}' -X POST "$BASE/api/progress" \
     --data-urlencode "course=not-a-course" \
     --data-urlencode "lesson=intro/welcome" --data-urlencode "done=1")
check "unknown course rejected" "$c" "400"

# A consultation has no lessons at all, so there is nothing to mark.
c=$(curl -s -b "$TMP/jar" -o /dev/null -w '%{http_code}' -X POST "$BASE/api/progress" \
     --data-urlencode "course=consult-60" \
     --data-urlencode "lesson=intro/welcome" --data-urlencode "done=1")
check "a service has no lessons to mark" "$c" "400"
check "nothing written for it" "$(count "SELECT COUNT(*) AS n FROM progress WHERE course_slug='consult-60';")" "0"

# The enrollment check itself: signed in, real course, real lesson — but she no
# longer owns it. This endpoint sits outside the gate, so it has to say no on
# its own.
$DB "UPDATE enrollments SET status='refunded';" >/dev/null 2>&1
c=$(curl -s -b "$TMP/jar" -o /dev/null -w '%{http_code}' -X POST "$BASE/api/progress" \
     --data-urlencode "course=dating" \
     --data-urlencode "lesson=safety/digital-safety" --data-urlencode "done=1")
check "progress into a course she doesn't own is refused" "$c" "403"
check "nothing written" "$(count "SELECT COUNT(*) AS n FROM progress WHERE lesson_id='safety/digital-safety';")" "0"
$DB "UPDATE enrollments SET status='active';" >/dev/null 2>&1

echo
echo "── Signed out, nobody can write progress ──────────"
c=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/progress" \
     --data-urlencode "lesson=safety/before-you-meet" --data-urlencode "done=1")
check "redirected to sign in" "$c" "302"
check "nothing written" "$(count "SELECT COUNT(*) AS n FROM progress WHERE lesson_id='safety/before-you-meet';")" "0"

echo
echo "── The account page ───────────────────────────────"
body=$(get /account)
echo "$body" | grep -q "prog@example.com"        && ok "shows her email"            || bad "email missing"
echo "$body" | grep -q 'value="Anna"'            && ok "shows her name, editable"   || bad "name field missing"
echo "$body" | grep -q "can't be changed here"   && ok "explains why email is fixed"|| bad "no explanation"
echo "$body" | grep -q "The Dating Method"       && ok "lists what she owns"        || bad "purchases missing"
echo "$body" | grep -q "247.00 USD"              && ok "shows what she paid"        || bad "price missing"
echo "$body" | grep -qi "Sign out"               && ok "offers sign out"            || bad "no sign out"

curl -s -b "$TMP/jar" -o /dev/null -X POST "$BASE/account" --data-urlencode "first_name=Mashenka"
has /account 'value="Mashenka"' && ok "name change saved" || bad "name did not save"
names=$($DB "SELECT first_name FROM students;" 2>/dev/null)
grep -q "Mashenka" <<< "$names" && ok "saved to the database" || bad "not persisted"

echo
echo "── Account page needs signing in ──────────────────"
check "signed-out visitor redirected" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/account")" "302"

echo
echo "═══════════════════════════════════════════════════"
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
