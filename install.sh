#!/bin/sh
# Installs the statuser CLI from a GitHub release of statuser-cloud/cli:
#
#   curl -fsSL https://raw.githubusercontent.com/statuser-cloud/cli/main/install.sh | sh
#
# STATUSER_VERSION=0.2.0 picks a version (default: the latest release),
# STATUSER_INSTALL_DIR a directory (default: /usr/local/bin when writable,
# otherwise ~/.local/bin). The archive is checked against SHA256SUMS of the
# same release before anything is installed. Nothing here asks for sudo.
set -eu

REPO="statuser-cloud/cli"

fail() {
  echo "statuser install: $1" >&2
  exit 1
}

case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=macos ;;
  *) fail "unsupported system $(uname -s); on Windows use install.ps1" ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch=x64 ;;
  arm64 | aarch64) arch=arm64 ;;
  *) fail "unsupported architecture $(uname -m)" ;;
esac

asset="statuser-$os-$arch.tar.gz"
if [ -n "${STATUSER_VERSION:-}" ]; then
  base="https://github.com/$REPO/releases/download/v${STATUSER_VERSION#v}"
else
  base="https://github.com/$REPO/releases/latest/download"
fi

if command -v curl >/dev/null 2>&1; then
  fetch() { curl -fsSL "$1" -o "$2"; }
elif command -v wget >/dev/null 2>&1; then
  fetch() { wget -qO "$2" "$1"; }
else
  fail "curl or wget is needed"
fi

if command -v sha256sum >/dev/null 2>&1; then
  sha256() { sha256sum "$1" | cut -d ' ' -f 1; }
elif command -v shasum >/dev/null 2>&1; then
  sha256() { shasum -a 256 "$1" | cut -d ' ' -f 1; }
else
  fail "sha256sum or shasum is needed to check the download"
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

fetch "$base/$asset" "$tmp/$asset" || fail "cannot download $base/$asset"
fetch "$base/SHA256SUMS" "$tmp/SHA256SUMS" || fail "cannot download SHA256SUMS"
expected="$(awk -v f="$asset" '$2 == f { print $1 }' "$tmp/SHA256SUMS")"
[ -n "$expected" ] || fail "$asset is not listed in SHA256SUMS"
[ "$(sha256 "$tmp/$asset")" = "$expected" ] || fail "checksum mismatch for $asset"
tar -xzf "$tmp/$asset" -C "$tmp" statuser

dir="${STATUSER_INSTALL_DIR:-}"
if [ -z "$dir" ]; then
  if [ -w /usr/local/bin ]; then dir=/usr/local/bin; else dir="$HOME/.local/bin"; fi
fi
mkdir -p "$dir"
# A fresh file moved into place: the old binary may be running right now.
cp "$tmp/statuser" "$dir/.statuser.new"
chmod 755 "$dir/.statuser.new"
mv -f "$dir/.statuser.new" "$dir/statuser"

echo "statuser $("$dir/statuser" --version) installed to $dir/statuser"
case ":$PATH:" in
  *":$dir:"*) ;;
  *) echo "Add $dir to PATH to run it as statuser." ;;
esac
echo "Shell completion: statuser completion --help"
