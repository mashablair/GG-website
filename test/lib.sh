#!/bin/bash
# Shared helpers for the test suites.

BASE=${BASE:-http://127.0.0.1:8788}
DEV_LOG=${DEV_LOG:-/tmp/wrangler-dev.log}
DB="npx --yes wrangler@latest d1 execute dating-goddess-db --local -y --command"

# Does this page contain that text?
#
# A herestring, never a pipe. `grep -q` exits on its first match and closes the
# pipe, killing curl with SIGPIPE — and with `set -o pipefail` the whole
# pipeline then reports failure even though the match succeeded. It only shows
# up when the page is big enough not to fit the pipe buffer first, which made it
# look like a rare, mysterious app bug.
page_has() {  # url pattern [curl args...]
  local url="$1" pattern="$2"; shift 2
  local body
  body=$(curl -s "$@" "$BASE$url")
  grep -q "$pattern" <<< "$body"
}

# How many codes the log holds. Always a single number, even when it's empty.
count_codes() {
  local n
  n=$(grep -c 'Your sign-in code is' "$DEV_LOG" 2>/dev/null | head -1)
  echo "${n:-0}"
}

# Ask for a sign-in code and return it.
#
# Wrangler buffers its console output, so the code can take a moment to reach
# the log. Waiting a fixed second and taking the last line races that write and
# silently returns the *previous* code — which then fails to verify and looks
# like a bug in the app. Instead: note how many codes the log holds, ask for a
# new one, and wait until the count actually goes up.
request_code() {
  local email="$1"
  local before after tries=0
  # grep -c prints 0 AND exits non-zero when nothing matches, so `|| echo 0`
  # would append a second 0 and break the comparison. Take the output, ignore
  # the exit code.
  before=$(count_codes)

  curl -s -o /dev/null -X POST "$BASE/login" \
    --data-urlencode "step=request" --data-urlencode "email=$email"

  while [ $tries -lt 60 ]; do
    after=$(count_codes)
    if [ "$after" -gt "$before" ]; then
      grep -o 'Your sign-in code is [0-9]\{6\}' "$DEV_LOG" | tail -1 | grep -oE '[0-9]{6}'
      return 0
    fi
    sleep 0.25
    tries=$((tries + 1))
  done

  return 1   # no code appeared — the caller should treat this as a failure
}

# Sign in and leave the session cookie in $1.
sign_in() {
  local jar="$1" email="$2" code
  code=$(request_code "$email") || return 1
  curl -s -c "$jar" -o /dev/null -X POST "$BASE/login" \
    --data-urlencode "step=verify" --data-urlencode "email=$email" --data-urlencode "code=$code"
  grep -q idm_session "$jar"
}
