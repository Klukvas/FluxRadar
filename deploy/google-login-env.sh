#!/usr/bin/env bash
# Validate key shape/presence only; never source, copy or print credentials.
load_google_login_env() {
  GOOGLE_LOGIN_ENV_FILE="$1"
  GOOGLE_LOGIN_REQUIRED="$2"
  GOOGLE_LOGIN_ENV_ARGS=()
  if ! [[ "$GOOGLE_LOGIN_ENV_FILE" =~ ^/[A-Za-z0-9_./-]+$ ]]; then
    echo 'Google login overlay path must be an absolute metadata-safe path' >&2; return 1
  fi
  case "$GOOGLE_LOGIN_REQUIRED" in true|false) ;; *) echo 'Invalid Google login requirement metadata' >&2; return 1;; esac
  if [ -L "$GOOGLE_LOGIN_ENV_FILE" ]; then
    echo 'Google login overlay must be a regular, nonsymlink file' >&2; return 1
  elif [ -e "$GOOGLE_LOGIN_ENV_FILE" ]; then
    if [ ! -f "$GOOGLE_LOGIN_ENV_FILE" ] || [ ! -r "$GOOGLE_LOGIN_ENV_FILE" ] \
      || [ "$(stat -c '%u:%a' "$GOOGLE_LOGIN_ENV_FILE")" != '0:600' ]; then
      echo 'Google login overlay must be readable and owned by root with mode600' >&2; return 1
    fi
    if ! awk '
      { separator=index($0,"="); key=substr($0,1,separator-1); value=substr($0,separator+1)
        if (!separator || value=="" || value ~ /[[:space:]]/ || seen[key]++) bad=1
        if (key!="GOOGLE_LOGIN_CLIENT_ID" && key!="GOOGLE_LOGIN_CLIENT_SECRET" && key!="GOOGLE_LOGIN_REDIRECT_URI") bad=1 }
      END { exit (bad || NR!=3) }
    ' "$GOOGLE_LOGIN_ENV_FILE"; then
      echo 'Google login overlay must contain exactly the three nonempty login keys' >&2; return 1
    fi
    GOOGLE_LOGIN_REQUIRED=true
    GOOGLE_LOGIN_ENV_ARGS=(--env-file "$GOOGLE_LOGIN_ENV_FILE")
  elif [ "$GOOGLE_LOGIN_REQUIRED" = true ]; then
    echo 'Required Google login overlay is missing; refusing to disable existing login' >&2; return 1
  else
    GOOGLE_LOGIN_ENV_FILE=''
  fi
}
