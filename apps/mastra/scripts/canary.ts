import { MastraClient } from "@mastra/client-js";
import { createRuntimeConfig } from "../src/mastra/runtime-config.ts";

const config = createRuntimeConfig();
const client = new MastraClient({ baseUrl: `http://${config.host}:${config.port}` });
const response = await fetch(`http://${config.host}:${config.port}/korgo/health`);
if (!response.ok) throw new Error(`Mastra health canary failed with HTTP ${response.status}.`);
const health = await response.json();

// Force client construction into the canary so API compatibility is checked at build time.
void client;
console.log(JSON.stringify({ ok: true, health }, null, 2));
