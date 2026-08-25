import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntimeConfig } from "../src/mastra/runtime-config.ts";

const packageDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const projectRoot = dirname(dirname(packageDirectory));
const config = createRuntimeConfig();
const checks = {
  loopbackOnly: config.host === "127.0.0.1",
  hermesCheckout: existsSync(join(projectRoot, "hermes")),
  hermesConfigured: config.hermes.configured,
  mastraAuthConfigured: config.auth.configured,
  dataDirectoryOutsideCheckout: !config.dataDirectory.startsWith(projectRoot),
};

console.log(JSON.stringify({ ok: Object.values(checks).every(Boolean), checks }, null, 2));
if (!Object.values(checks).every(Boolean)) process.exitCode = 1;
