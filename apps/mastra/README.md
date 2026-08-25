# Hermes Mastra backbone

This workspace makes Mastra the orchestration plane for Hermes Bots without replacing Hermes.

- Mastra owns agents, durable workflows, memory, RAG, evaluation, storage, observability, MCP, auth, and the local Studio/API.
- Hermes owns machine execution and connected-app execution. Mastra delegates through Hermes's authenticated `/v1/chat/completions` API and retains Hermes completion/session evidence.
- Composio credentials remain in the Electron `safeStorage` connector store. Mastra never reads or copies them; Hermes uses connected Composio tools after an execution request is approved.
- The desktop app remains the operator UI. Its main process now starts Mastra after Hermes passes HTTP and WebSocket readiness, shares only ephemeral child-process credentials, and tears both services down together. Approval cards and run views are the next renderer seam.

The service binds to `127.0.0.1:4112` so it can run beside the merged Done runtime on `4111`. Its durable databases live under `~/Library/Application Support/Hermes Bots/Mastra`, outside the source checkout.

Useful commands from the repository root:

```bash
npm run mastra:dev
npm run mastra:build
npm run mastra:doctor
npm run mastra:canary
```

Secrets are process-injected only. `KORGO_HERMES_API_KEY` may be supplied from the existing Hermes `API_SERVER_KEY`; `KORGO_MASTRA_JWT_SECRET` protects Mastra API routes. Neither belongs in a checked-in environment file.
