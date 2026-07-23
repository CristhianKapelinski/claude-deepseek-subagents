# claude-deepseek-subagents

Run **DeepSeek v4** as real, native subagents inside **Claude Code** — while your **main agent stays on your Claude subscription**.

Your orchestrator keeps thinking on Opus (on the plan you already pay for). The heavy, token-hungry work — searching, reading, mechanical edits, running tests, scoped implementation — gets delegated to subagents that run the full Claude Code agent loop (tools, multi-step, isolated context) powered by DeepSeek at a fraction of the cost. The orchestrator then verifies their output.

No third-party cloud relay. Your code never leaves your machine except the DeepSeek API calls themselves.

## How it works

Claude Code sends every request to `ANTHROPIC_BASE_URL`. This ships a tiny (~90-line, zero-dependency) Node proxy that points there and routes each request by its `model` field:

```
Claude Code ──ANTHROPIC_BASE_URL=127.0.0.1:8080──▶ proxy inspects body.model
   │  (your subscription OAuth token)                   │
   │                                    claude-*  ──────┤─▶ api.anthropic.com        (headers passed THROUGH,
   │                                                    │                             so your subscription is used)
   └─ subagents ds-flash / ds-pro       deepseek-* ─────┴─▶ api.deepseek.com/anthropic (Authorization swapped
                                                                                        for your DeepSeek key)
```

The trick: for `claude-*` requests the proxy forwards your headers **untouched**, so Claude Code's own subscription OAuth token reaches Anthropic exactly as if there were no proxy. Only `deepseek-*` requests get their auth swapped for your DeepSeek key. The main agent stays on your plan; the subagents run on DeepSeek — in the same session.

The subagents are ordinary Claude Code named subagents (`~/.claude/agents/ds-flash.md`, `ds-pro.md`) whose `model:` frontmatter is a `deepseek-*` id. Nothing exotic — the routing is all in the proxy.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/CristhianKapelinski/claude-deepseek-subagents/main/install.sh | bash
```

or from a clone:

```bash
git clone https://github.com/CristhianKapelinski/claude-deepseek-subagents
cd claude-deepseek-subagents
./install.sh
```

Then put your DeepSeek key (from <https://platform.deepseek.com/>) in `~/.claude/deepseek/.env`:

```
DEEPSEEK_API_KEY=sk-...
```

Requirements: `node` (18+), `curl`, and a working `claude` (Claude Code) logged into your subscription.

## Use

```bash
claude-ds
```

That launches Claude Code with:

- the main model pinned to **Opus 4.8 with 1M context** on your subscription (override with `DEEPSEEK_MAIN_MODEL=...`),
- the proxy started automatically,
- a delegation policy injected so the orchestrator delegates to `ds-flash` (default) / `ds-pro` (hard reasoning) and **verifies** their work, using Claude subagents only when you explicitly ask.

Plain `claude` is left completely untouched.

Inspect the router from **another** terminal:

```bash
ds-proxy status      # up/down, pid, key present
ds-proxy log         # live: each call shows  model -> DEEPSEEK | anthropic
ds-proxy restart     # after editing proxy.mjs
```

> **Do not** run `ds-proxy stop/restart` from inside a `claude-ds` session — that session talks to the API *through* the proxy, so killing it drops its own connection. Manage the proxy from a normal terminal.

## What runs where

| | Model | Endpoint | Billing |
|---|---|---|---|
| Main / orchestrator | Opus 4.8 (1M) | Anthropic | your subscription |
| `ds-flash` subagent (default) | deepseek-v4-flash | DeepSeek | DeepSeek API |
| `ds-pro` subagent (hard tasks) | deepseek-v4-pro | DeepSeek | DeepSeek API |

Model ids follow DeepSeek's V4 naming (`deepseek-v4-flash`, `deepseek-v4-pro`). Edit the `model:` line in the agent files to change them.

## Multi-agent workflows

Workflow `agent()` calls inherit the session model (Opus) by default, so a multi-agent workflow runs on Claude unless you route it. The injected policy tells the orchestrator to pass `agentType: 'ds-flash'` / `'ds-pro'` (or `model: 'deepseek-v4-flash'`) to fan-out agents. Workflows hard-coded inside a skill keep whatever their script specifies.

## Notes & caveats

- **Prompt caching** is per-provider: Anthropic caches the main agent's context, DeepSeek caches within a subagent's loop. Neither is shared across the boundary (inherent, not a proxy limitation).
- The proxy synthesizes `count_tokens` for DeepSeek routes (DeepSeek's Anthropic-compatible endpoint may not implement it) so preflight never stalls.
- OAuth passthrough through a local proxy is **tolerated, not officially supported**. If a Claude Code update ever changes auth handling, just use plain `claude` and the proxy for something else.
- The proxy binds `127.0.0.1:8080`. Change with `DEEPSEEK_PROXY_PORT`.
- `.env` holds a secret and is git-ignored. Keep it `chmod 600`.

## Uninstall

```bash
rm -f ~/.local/bin/claude-ds ~/.local/bin/ds-proxy
rm -rf ~/.claude/deepseek
rm -f ~/.claude/agents/ds-flash.md ~/.claude/agents/ds-pro.md
```

## License

MIT — see [LICENSE](LICENSE).
