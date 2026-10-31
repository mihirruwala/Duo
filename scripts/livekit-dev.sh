#!/usr/bin/env bash
# Local LiveKit server for development, without Docker or Homebrew.
#
# macOS: downloads Homebrew's prebuilt `livekit` bottle for this machine straight from
# ghcr.io, verifies its SHA-256 against Homebrew's published formula metadata, and runs
# `livekit-server --dev` (API key "devkey", secret "secret", ws://localhost:7880).
# Linux: uses the official GitHub release tarball.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN_DIR="$ROOT/bin"
BIN="$BIN_DIR/livekit-server"

install_macos() {
  local arch tag meta url sha tmp token
  arch="$(uname -m)"
  case "$(sw_vers -productVersion | cut -d. -f1)" in
    26) tag="tahoe" ;; 15) tag="sequoia" ;; 14) tag="sonoma" ;; *) tag="sequoia" ;;
  esac
  [[ "$arch" == "arm64" ]] && tag="arm64_${tag}"

  meta="$(curl -fsSL https://formulae.brew.sh/api/formula/livekit.json)"
  read -r url sha < <(python3 -I -c '
import json, sys
d = json.loads(sys.argv[1]); files = d["bottle"]["stable"]["files"]; tag = sys.argv[2]
f = files.get(tag) or files.get("arm64_sequoia" if tag.startswith("arm64") else "sequoia")
print(f["url"], f["sha256"])' "$meta" "$tag")

  tmp="$(mktemp -d)"
  token="$(curl -fsSL "https://ghcr.io/token?scope=repository:homebrew/core/livekit:pull" | python3 -I -c 'import json,sys; print(json.load(sys.stdin)["token"])')"
  echo "Downloading LiveKit bottle ($tag)…"
  curl -fsSL -H "Authorization: Bearer $token" -o "$tmp/livekit.tar.gz" "$url"
  echo "$sha  $tmp/livekit.tar.gz" | shasum -a 256 -c -
  mkdir -p "$tmp/x" "$BIN_DIR"
  tar -xzf "$tmp/livekit.tar.gz" -C "$tmp/x"
  cp "$(find "$tmp/x" -type f -name livekit-server -perm -u+x | head -1)" "$BIN"
  chmod +x "$BIN"
  rm -rf "$tmp"
}

install_linux() {
  local ver="v1.13.10" arch tmp
  arch="$(uname -m)"; [[ "$arch" == "x86_64" ]] && arch="amd64"; [[ "$arch" == "aarch64" ]] && arch="arm64"
  tmp="$(mktemp -d)"
  curl -fsSL -o "$tmp/lk.tgz" "https://github.com/livekit/livekit/releases/download/${ver}/livekit_${ver#v}_linux_${arch}.tar.gz"
  mkdir -p "$BIN_DIR" && tar -xzf "$tmp/lk.tgz" -C "$BIN_DIR" livekit-server
  rm -rf "$tmp"
}

if [[ ! -x "$BIN" ]]; then
  if [[ "$(uname)" == "Darwin" ]]; then install_macos; else install_linux; fi
fi

"$BIN" --version
exec "$BIN" --dev --bind 127.0.0.1 "$@"
