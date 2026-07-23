#!/usr/bin/env bash
# Installer for claude-deepseek-subagents.
#
# One-liner (downloads everything):
#   curl -fsSL https://raw.githubusercontent.com/CristhianKapelinski/claude-deepseek-subagents/main/install.sh | bash
#
# Or from a clone:
#   git clone https://github.com/CristhianKapelinski/claude-deepseek-subagents && cd claude-deepseek-subagents && ./install.sh
#
# Pass the key up front (optional, avoids the manual .env edit):
#   DEEPSEEK_API_KEY=sk-xxxx bash -c "$(curl -fsSL .../install.sh)"
set -euo pipefail

RAW="https://raw.githubusercontent.com/CristhianKapelinski/claude-deepseek-subagents/main"
DS_DIR="$HOME/.claude/deepseek"
AGENTS="$HOME/.claude/agents"
BIN="$HOME/.local/bin"
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-.}")" 2>/dev/null && pwd || true)"

say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!  \033[0m %s\n' "$*" >&2; }

need() { command -v "$1" >/dev/null 2>&1 || { warn "missing dependency: $1"; MISSING=1; }; }
MISSING=0
need node; need claude; need curl
[ "$MISSING" = 1 ] && { warn "install the missing tools above and re-run."; exit 1; }

mkdir -p "$DS_DIR" "$AGENTS" "$BIN"

# fetch <relative-path> <destination> : copy from local clone if present, else download
fetch() {
  local rel="$1" dst="$2"
  if [ -n "$SELF_DIR" ] && [ -f "$SELF_DIR/$rel" ]; then
    cp "$SELF_DIR/$rel" "$dst"
  else
    curl -fsSL "$RAW/$rel" -o "$dst"
  fi
}

say "Installing proxy, launchers and manager into $DS_DIR"
fetch proxy.mjs       "$DS_DIR/proxy.mjs"
fetch claude-ds       "$DS_DIR/claude-ds"
fetch claude-deepseek "$DS_DIR/claude-deepseek"
fetch ds-proxy        "$DS_DIR/ds-proxy"
fetch policy.txt      "$DS_DIR/policy.txt"
chmod +x "$DS_DIR/claude-ds" "$DS_DIR/claude-deepseek" "$DS_DIR/ds-proxy"

say "Installing named subagents into $AGENTS"
fetch agents/ds-flash.md "$AGENTS/ds-flash.md"
fetch agents/ds-pro.md   "$AGENTS/ds-pro.md"

say "Linking launchers into $BIN"
ln -sf "$DS_DIR/claude-ds"       "$BIN/claude-ds"
ln -sf "$DS_DIR/claude-deepseek" "$BIN/claude-deepseek"
ln -sf "$DS_DIR/ds-proxy"        "$BIN/ds-proxy"

# DeepSeek key
if [ ! -f "$DS_DIR/.env" ]; then
  if [ -n "${DEEPSEEK_API_KEY:-}" ]; then
    printf 'DEEPSEEK_API_KEY=%s\n' "$DEEPSEEK_API_KEY" > "$DS_DIR/.env"
    say "Wrote DeepSeek key to $DS_DIR/.env"
  else
    printf '# Get a key at https://platform.deepseek.com/\nDEEPSEEK_API_KEY=\n' > "$DS_DIR/.env"
    warn "No key yet. Edit $DS_DIR/.env and set DEEPSEEK_API_KEY=sk-..."
  fi
  chmod 600 "$DS_DIR/.env"
else
  say "Keeping existing $DS_DIR/.env"
fi

echo
say "Done."
case ":$PATH:" in *":$BIN:"*) : ;; *) warn "$BIN is not on your PATH. Add:  export PATH=\"\$BIN:\$PATH\"";; esac
cat <<'EOF'

Usage:
  claude-ds              # main model on your subscription, subagents on DeepSeek
  claude-deepseek        # EVERYTHING on DeepSeek (main + subagents), subscription untouched
  ds-proxy status|log    # inspect the router (run from a NORMAL terminal, never inside a session)

The main agent runs Opus 4.8 (1M) on your Claude subscription. When it delegates,
it spawns the ds-flash / ds-pro subagents, which run the full agent loop on DeepSeek.
EOF
