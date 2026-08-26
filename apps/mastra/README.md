# Hermes Mastra backbone

This workspace makes Mastra the orchestration plane for Hermes Bots without replacing Hermes.

- Mastra owns agents, durable workflows, memory, RAG, evaluation, storage, observability, MCP, auth, and the local Studio/API.
- Hermes owns machine execution and connected-app execution. Approved workflows delegate through Hermes's authenticated `/v1/chat/completions` API and retain Hermes completion/session evidence.
- Canonical Bot conversations enter through the Mastra supervisor. Pure conversation turns use workspace-scoped memory without creating an action workflow. Typed Orgo, general Hermes, Composio, and GoHighLevel tool proposals only create durable workflows; the supervisor cannot call the execution endpoint directly.
- Mastra resolves the active profile's existing provider authentication through Hermes's authenticated `/v1/model/chat/completions` bridge. That bridge forwards model messages and Mastra tool schemas without constructing an action-capable Hermes agent, so it cannot load Hermes tools, skills, memory, terminal state, or execution sessions.
- Composio credentials remain in the Electron `safeStorage` connector store. Mastra never reads or copies them; Hermes uses connected Composio tools after an execution request is approved.
- The desktop app remains the operator UI. Its main process starts Mastra after Hermes passes HTTP and WebSocket readiness, shares only ephemeral child-process credentials, and tears both services down together.
- The renderer exposes a dedicated `/runs` workspace, a compact active-run surface in the right rail, and one unified approval queue for Hermes tool approvals and Mastra workflow approvals. Run details include workflow steps, recovery actions, sanitized output, trace metadata, and artifact-backed evidence.

The service binds to `127.0.0.1:4112` so it can run beside the merged Done runtime on `4111`. Its durable databases live outside the source checkout: under `~/Library/Application Support/Hermes Bots/Mastra` on macOS, `%LOCALAPPDATA%\\Hermes Bots\\Mastra` on Windows, and `${XDG_DATA_HOME:-~/.local/share}/hermes-bots/mastra` on Linux.

Production desktop builds bundle the generated local Mastra runtime without Studio and retain the same authenticated loopback-only control plane. Electron main owns the JWT secret, short-lived tokens, tunnel port, and runtime instance nonce; none are returned to renderer code. Restart recovery is bounded, and suspended runs are recovered from Mastra storage. For the shared Orgo profile, a pinned, hash-verified Linux Mastra and Node bundle is provisioned beside Hermes, remains bound to remote loopback, persists under the remote Hermes home, and is reached only through the existing main-process-owned Tailscale SSH lifecycle.

The authenticated desktop adapter exposes stable message, turn, and run DTOs rather than Mastra's native wire format. Tool approvals are bound to the tool name, canonical arguments, policy version, run ID, and current Mastra instance nonce; the identity is verified again before workflow resume.

When an existing Bot Chat is upgraded, Electron main imports at most the latest 500 conversational Hermes messages into the same Mastra thread ID. The import excludes tool and system payloads, redacts sensitive text, uses stable Hermes row identities, and is idempotent across reconnects. Orgo Bot connections default to Mastra conversations; the Runs header exposes a connection-scoped direct-Hermes compatibility switch, and an enabled Mastra conversation fails closed if the supervisor is unavailable instead of silently changing execution paths.

Useful commands from the repository root:

```bash
npm run mastra:dev
npm run mastra:build
npm run mastra:doctor
npm run mastra:canary
```

Secrets are process-injected only. `KORGO_HERMES_API_KEY` may be supplied from the existing Hermes `API_SERVER_KEY`; `KORGO_MASTRA_JWT_SECRET` protects Mastra API routes. Neither belongs in a checked-in environment file.
