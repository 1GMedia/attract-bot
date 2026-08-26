import { homedir } from "node:os";
import { join } from "node:path";
import type { MastraModelConfig } from "@mastra/core/llm";

const DEFAULT_MASTRA_PORT = 4112;
const DEFAULT_HERMES_URL = "http://127.0.0.1:8642";

export interface MastraRuntimeConfig {
  host: "127.0.0.1";
  port: number;
  dataDirectory: string;
  model: MastraModelConfig;
  modelBoundary: "direct-development" | "hermes-model-only" | "unconfigured";
  modelConfigured: boolean;
  instanceId: string;
  runtimeLocation: "local" | "orgo";
  runtimeVersion?: string;
  auth: {
    configured: boolean;
    jwtSecret?: string;
  };
  hermes: {
    baseUrl: string;
    apiKey?: string;
    configured: boolean;
    defaultProfile: string;
    requestTimeoutMs: number;
  };
}

export function createRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env,
  homeDirectory = homedir(),
  runtimePlatform: NodeJS.Platform = process.platform,
): MastraRuntimeConfig {
  const jwtSecret = cleanSecret(environment.KORGO_MASTRA_JWT_SECRET);
  const hermesApiKey = cleanSecret(environment.KORGO_HERMES_API_KEY ?? environment.API_SERVER_KEY);
  const hermesBaseUrl = normalizeHermesUrl(environment.KORGO_HERMES_URL || DEFAULT_HERMES_URL);
  const profile = normalizeProfile(environment.KORGO_HERMES_PROFILE || "default");
  const configuredModel = normalizeModel(environment.KORGO_MASTRA_MODEL || "openai/gpt-5.6-sol");
  const directDevelopment = environment.KORGO_MASTRA_ALLOW_DIRECT_MODEL === "1"
    && hasModelCredential(configuredModel, environment);
  const modelBoundary = hermesApiKey
    ? "hermes-model-only"
    : directDevelopment
      ? "direct-development"
      : "unconfigured";
  const model: MastraModelConfig = hermesApiKey
    ? {
        providerId: "hermes-model",
        modelId: "active",
        url: profile === "default"
          ? `${hermesBaseUrl}/v1/model`
          : `${hermesBaseUrl}/p/${encodeURIComponent(profile)}/v1/model`,
        apiKey: hermesApiKey,
      }
    : configuredModel;

  return {
    host: "127.0.0.1",
    port: parsePort(environment.KORGO_MASTRA_PORT),
    dataDirectory: environment.KORGO_MASTRA_DATA_DIR?.trim() || defaultDataDirectory(
      environment,
      homeDirectory,
      runtimePlatform,
    ),
    model,
    modelBoundary,
    modelConfigured: modelBoundary !== "unconfigured",
    instanceId: environment.KORGO_MASTRA_INSTANCE_ID?.trim() || "standalone",
    runtimeLocation: environment.KORGO_MASTRA_RUNTIME_LOCATION === "orgo" ? "orgo" : "local",
    ...(environment.KORGO_MASTRA_RUNTIME_VERSION?.trim()
      ? { runtimeVersion: environment.KORGO_MASTRA_RUNTIME_VERSION.trim() }
      : {}),
    auth: {
      configured: Boolean(jwtSecret),
      ...(jwtSecret ? { jwtSecret } : {}),
    },
    hermes: {
      baseUrl: hermesBaseUrl,
      configured: Boolean(hermesApiKey),
      ...(hermesApiKey ? { apiKey: hermesApiKey } : {}),
      defaultProfile: profile,
      requestTimeoutMs: parsePositiveInteger(
        environment.KORGO_HERMES_TIMEOUT_MS,
        15 * 60 * 1_000,
      ),
    },
  };
}

export function defaultDataDirectory(
  environment: NodeJS.ProcessEnv,
  homeDirectory: string,
  runtimePlatform: NodeJS.Platform,
): string {
  if (runtimePlatform === "win32") {
    return join(environment.LOCALAPPDATA?.trim() || join(homeDirectory, "AppData", "Local"), "Hermes Bots", "Mastra");
  }
  if (runtimePlatform === "darwin") {
    return join(homeDirectory, "Library", "Application Support", "Hermes Bots", "Mastra");
  }
  return join(environment.XDG_DATA_HOME?.trim() || join(homeDirectory, ".local", "share"), "hermes-bots", "mastra");
}

export function hasModelCredential(model: string, environment: NodeJS.ProcessEnv = process.env): boolean {
  const provider = model.split("/", 1)[0]?.toLowerCase();
  const keys: Record<string, string[]> = {
    anthropic: ["ANTHROPIC_API_KEY"],
    google: ["GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY"],
    openai: ["OPENAI_API_KEY"],
    openrouter: ["OPENROUTER_API_KEY"],
  };

  return (keys[provider] || []).some((key) => Boolean(cleanSecret(environment[key])));
}

export function normalizeModel(value: string): string {
  const model = value.trim();
  if (!model) return "openai/gpt-5.6-sol";
  return model.includes("/") ? model : `openai/${model}`;
}

export function normalizeProfile(value: string): string {
  const profile = value.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(profile)) {
    throw new Error("Hermes profile must contain only letters, numbers, underscores, or hyphens.");
  }
  return profile;
}

export function normalizeHermesUrl(value: string): string {
  const url = new URL(value.trim());
  const isLoopback = ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) {
    throw new Error("Hermes must use HTTPS unless it is bound to the local loopback interface.");
  }
  url.pathname = url.pathname.replace(/\/$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function cleanSecret(value: string | undefined): string | undefined {
  const secret = value?.trim();
  return secret || undefined;
}

function parsePort(value: string | undefined): number {
  const port = parsePositiveInteger(value, DEFAULT_MASTRA_PORT);
  if (port > 65_535) throw new Error("KORGO_MASTRA_PORT must be a valid TCP port.");
  return port;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("Runtime numeric configuration must be a positive integer.");
  }
  return parsed;
}

export const mastraRuntimeConfig = createRuntimeConfig();
