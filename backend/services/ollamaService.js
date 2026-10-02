/**
 * services/ollamaService.js
 * Centralized provider for the Master AI system — configurable Ollama (the
 * ONLY AI provider). The backend is the sole caller; the browser never talks
 * to Ollama directly. Local development defaults to localhost; production
 * requires an explicitly configured reachable service URL.
 *
 * Responsibilities (single module, no hard-coded config):
 *   - connection management        (base URL, reachable /api/tags checks)
 *   - model requests               (list installed models, verify configured model)
 *   - non-streaming chat           (Ollama /api/chat stream:false)
 *   - streaming chat               (Ollama /api/chat stream:true → normalized frames)
 *   - request timeouts             (connect + full-request, abort-safe)
 *   - error handling & normalizing (OllamaError with stable codes + friendly text)
 *   - response normalization       (token frames {type:'content'|'done'}, {content})
 *   - logging                      (technical detail stays ON the backend)
 *
 * Friendly user messages are returned in error.message; technical detail is kept
 * in error.detail and logged here — internal URLs/statuses never reach the UI.
 */

const env = require("../config/env");

const MAX_LOGGED_BODY = 300;

function prepareMessages(messages, images) {
  const safeMessages = (Array.isArray(messages) ? messages : []).map(
    (item) => ({
      ...item,
    }),
  );
  const latestUser = [...safeMessages]
    .reverse()
    .find((item) => item.role === "user");
  if (latestUser && Array.isArray(images) && images.length) {
    latestUser.images = [...(latestUser.images || []), ...images];
  }
  return safeMessages;
}

/* Stable, machine-readable error codes used across the route layer. */
const ERROR_CODES = Object.freeze({
  PROVIDER_NOT_CONFIGURED: "PROVIDER_NOT_CONFIGURED",
  OLLAMA_UNAVAILABLE: "OLLAMA_UNAVAILABLE",
  MODEL_NOT_FOUND: "MODEL_NOT_FOUND",
  TIMEOUT: "TIMEOUT",
  EMPTY_RESPONSE: "EMPTY_RESPONSE",
  BAD_REQUEST: "BAD_REQUEST",
  GENERAL: "GENERAL",
});

/* Friendly messages shown to users. Technical details never leak here. */
const USER_MESSAGES = Object.freeze({
  [ERROR_CODES.PROVIDER_NOT_CONFIGURED]:
    "AI service is not configured. Please contact the administrator.",
  [ERROR_CODES.OLLAMA_UNAVAILABLE]:
    "AI service is temporarily unavailable. Please try again later.",
  [ERROR_CODES.MODEL_NOT_FOUND]:
    "The AI model is currently unavailable. Please contact the administrator.",
  [ERROR_CODES.TIMEOUT]:
    "AI Assistant took too long to respond. Please try again.",
  [ERROR_CODES.EMPTY_RESPONSE]:
    "The AI Assistant returned an empty response. Please try again.",
  [ERROR_CODES.BAD_REQUEST]:
    "Something went wrong while generating the response. Please try again.",
  [ERROR_CODES.GENERAL]:
    "Something went wrong while generating the response. Please try again.",
});

/* Rational HTTP status for each code (the route maps these for non-SSE errors). */
const HTTP_STATUS = Object.freeze({
  [ERROR_CODES.PROVIDER_NOT_CONFIGURED]: 503,
  [ERROR_CODES.OLLAMA_UNAVAILABLE]: 503,
  [ERROR_CODES.MODEL_NOT_FOUND]: 500,
  [ERROR_CODES.TIMEOUT]: 504,
  [ERROR_CODES.EMPTY_RESPONSE]: 502,
  [ERROR_CODES.BAD_REQUEST]: 400,
  [ERROR_CODES.GENERAL]: 502,
});

class OllamaError extends Error {
  constructor(code, detail, options = {}) {
    const userMessage =
      (typeof options.overrideUserMessage === "string" &&
        options.overrideUserMessage.trim()) ||
      USER_MESSAGES[code] ||
      USER_MESSAGES[ERROR_CODES.GENERAL];
    super(userMessage);
    this.name = "OllamaError";
    this.code = code;
    this.detail =
      typeof detail === "string" && detail.trim()
        ? detail.slice(0, MAX_LOGGED_BODY)
        : "unknown";
    this.status = options.status || HTTP_STATUS[code] || 502;
    this.isOllamaError = true;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

/* Merge an optional external abort signal with an internal timeout signal. */
function mergeSignals(...signals) {
  const active = signals.filter(Boolean);
  if (active.length === 0) return undefined;
  if (active.length === 1) return active[0];
  if (typeof AbortSignal.any === "function") return AbortSignal.any(active);
  const controller = new AbortController();
  for (const signal of active) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return controller.signal;
}

const ollamaService = {
  /* ── Configuration (centralized here — reads env, never hard-codes) ── */
  get baseUrl() {
    const externalUrl = env.OLLAMA_BASE_URL;
    if (externalUrl && externalUrl.trim()) {
      return externalUrl.trim().replace(/\/+$/, "");
    }
    return env.NODE_ENV === "production" ? "" : "http://localhost:11434";
  },
  get model() {
    return (env.OLLAMA_MODEL || "llama3.2").trim();
  },
  get timeoutMs() {
    return Number(env.OLLAMA_TIMEOUT_MS) || 120000;
  },
  get pingTimeoutMs() {
    return Number(env.OLLAMA_PING_TIMEOUT_MS) || 3000;
  },
  get maxTokens() {
    const value = Number(env.OLLAMA_MAX_TOKENS);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1500;
  },
  isEnabled() {
    return env.AI_SUPPORT_ENABLED !== "false";
  },

  /* ── Logging (technical detail stays server-side) ── */
  log(level, message, extra) {
    const fn = console[level] || console.log;
    const suffix =
      extra && typeof extra === "object"
        ? ` | ${Object.entries(extra)
            .map(([key, value]) => `${key}=${value}`)
            .join(" | ")}`
        : "";
    fn(`[Master AI][Ollama] ${message}${suffix}`);
  },

  _safe(error) {
    return String((error && error.message) || error || "unknown error").slice(
      0,
      MAX_LOGGED_BODY,
    );
  },

  _logResponseFailure(kind, status, startedAt, raw) {
    this.log("error", `${kind} request failed`, {
      status,
      model: this.model,
      duration_ms: Date.now() - startedAt,
      message: String(raw || "").slice(0, MAX_LOGGED_BODY),
    });
  },

  /* ── Connectivity / model-management ── */

  /**
   * Quick reachability check (GET /api/tags). Never throws — callers get a
   * normalized result. Used by the health endpoints and stream preflight.
   */
  async ping({ signal } = {}) {
    const startedAt = Date.now();
    if (!this.baseUrl) {
      this.log("error", "Provider URL is not configured");
      return {
        ok: false,
        status: 0,
        latencyMs: Date.now() - startedAt,
        timedOut: false,
        configurationError: ERROR_CODES.PROVIDER_NOT_CONFIGURED,
      };
    }
    const { controller, timedOut, clear } = this._timeoutBox(
      this.pingTimeoutMs,
    );
    const merged = mergeSignals(signal, controller.signal);
    let response;
    try {
      response = await fetch(`${this.baseUrl}/api/tags`, { signal: merged });
    } catch (error) {
      clear();
      this.log("error", "Ping failed", {
        message: this._safe(error),
        duration_ms: Date.now() - startedAt,
      });
      return {
        ok: false,
        status: 0,
        latencyMs: Date.now() - startedAt,
        timedOut: timedOut(),
      };
    }
    clear();
    const latencyMs = Date.now() - startedAt;
    if (!response.ok) {
      this.log("error", "Ping failed", {
        status: response.status,
        duration_ms: latencyMs,
      });
      return {
        ok: false,
        status: response.status,
        latencyMs,
        timedOut: timedOut(),
      };
    }
    this.log("info", "Ping succeeded", {
      status: response.status,
      duration_ms: latencyMs,
    });
    return { ok: true, status: response.status, latencyMs, timedOut: false };
  },

  /** List installed model names (normalized). Never throws. */
  async installedModels({ signal } = {}) {
    const startedAt = Date.now();
    const { controller, timedOut, clear } = this._timeoutBox(
      this.pingTimeoutMs,
    );
    const merged = mergeSignals(signal, controller.signal);
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        signal: merged,
      });
      clear();
      if (!response.ok) {
        this.log("error", "Installed models fetch failed", {
          status: response.status,
          timedOut: timedOut(),
        });
        return [];
      }
      const data = await response.json().catch(() => ({}));
      const models = Array.isArray(data.models)
        ? data.models
            .map((m) => (typeof m?.name === "string" ? m.name : ""))
            .filter(Boolean)
        : [];
      this.log("info", "Installed models fetched", {
        count: models.length,
        duration_ms: Date.now() - startedAt,
      });
      return models;
    } catch (error) {
      clear();
      this.log("error", "Installed models fetch failed", {
        message: this._safe(error),
        duration_ms: Date.now() - startedAt,
      });
      return [];
    }
  },

  /* Model-name matching tolerates Ollama tags like "llama3.2:latest". */
  isModelInstalled(model, installed = []) {
    const needle = String(model || this.model).toLowerCase();
    return (Array.isArray(installed) ? installed : []).some((name) => {
      const candidate = String(name).toLowerCase();
      return candidate === needle || candidate.startsWith(`${needle}:`);
    });
  },

  /**
   * Verify Ollama is reachable AND the configured model is installed.
   * Returns a normalized result; never throws.
   */
  async verifyModel(model, { signal } = {}) {
    const target = (typeof model === "string" && model.trim()) || this.model;
    const ping = await this.ping({ signal });
    const installedModels = ping.ok
      ? await this.installedModels({ signal })
      : [];
    const installed = this.isModelInstalled(target, installedModels);
    this.log("info", "Model verified", { model: target, installed });
    return {
      ok: ping.ok && installed,
      status: ping.ok ? 200 : ping.status,
      latencyMs: ping.latencyMs,
      installed,
      model: target,
      providerConfigured: Boolean(this.baseUrl),
      providerReachable: ping.ok,
    };
  },

  /* ── Chat: non-streaming ── */

  /**
   * Single-turn inference (Ollama /api/chat stream:false).
   * @returns {Promise<{content:string}>} normalized answer.
   * @throws {OllamaError} with a stable code + friendly user message.
   */
  async chat({ messages, system, images, signal, maxTokens } = {}) {
    if (!this.baseUrl) {
      throw new OllamaError(
        ERROR_CODES.PROVIDER_NOT_CONFIGURED,
        "OLLAMA_BASE_URL is not configured",
      );
    }
    const body = {
      model: this.model,
      system,
      messages: prepareMessages(messages, images),
      stream: false,
      options: { num_predict: maxTokens || this.maxTokens },
    };

    const startedAt = Date.now();
    const { controller, timedOut, clear } = this._timeoutBox(this.timeoutMs);
    const merged = mergeSignals(signal, controller.signal);
    let response;
    try {
      response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: merged,
      });
    } catch (error) {
      clear();
      if (timedOut()) {
        throw new OllamaError(
          ERROR_CODES.TIMEOUT,
          `Chat request timed out after ${this.timeoutMs}ms`,
          { cause: error },
        );
      }
      if (error && error.name === "AbortError") throw error; // caller aborted
      this.log("error", "Chat connection failed", {
        message: this._safe(error),
        duration_ms: Date.now() - startedAt,
      });
      throw new OllamaError(ERROR_CODES.OLLAMA_UNAVAILABLE, this._safe(error), {
        cause: error,
      });
    }
    clear();

    if (!response.ok) {
      const raw = await response.text().catch(() => "");
      this._logResponseFailure("chat", response.status, startedAt, raw);
      if (timedOut()) {
        throw new OllamaError(
          ERROR_CODES.TIMEOUT,
          `Chat request timed out after ${this.timeoutMs}ms`,
        );
      }
      if (response.status === 404) {
        throw new OllamaError(
          ERROR_CODES.MODEL_NOT_FOUND,
          `Model "${this.model}" not found on the Ollama server`,
        );
      }
      if (response.status === 400 || response.status === 422) {
        throw new OllamaError(
          ERROR_CODES.BAD_REQUEST,
          `Ollama rejected the chat request (status ${response.status}): ${raw}`,
        );
      }
      throw new OllamaError(
        ERROR_CODES.GENERAL,
        `Ollama chat request failed with status ${response.status}: ${raw}`,
      );
    }

    const data = await response.json().catch(() => null);
    const content =
      typeof data?.message?.content === "string"
        ? data.message.content.trim()
        : "";
    if (!content) {
      throw new OllamaError(
        ERROR_CODES.EMPTY_RESPONSE,
        `Ollama returned no content for model "${this.model}"`,
      );
    }
    this.log("info", "Chat response received", {
      model: this.model,
      duration_ms: Date.now() - startedAt,
      chars: content.length,
    });
    return { content };
  },

  /* ── Chat: streaming ── */

  /**
   * Streaming inference (Ollama /api/chat stream:true). Async generator that
   * yields normalized frames:
   *   { type: "content", content: "<tokens>" }
   *   { type: "done",    done: true }
   * Malformed NDJSON lines are skipped; completion is detected from Ollama's
   * final `done:true` frame. Connection/abort/empty handling is normalized.
   *
   * @throws {OllamaError} for reachability/model/timeout/empty failures.
   * @throws {AbortError}  raw when the CALLER aborted (e.g. client disconnect).
   */
  async *chatStream({ messages, system, images, signal, maxTokens } = {}) {
    const body = {
      model: this.model,
      system,
      messages: prepareMessages(messages, images),
      stream: true,
      options: { num_predict: maxTokens || this.maxTokens },
    };

    const startedAt = Date.now();
    const { controller, timedOut, clear } = this._timeoutBox(this.timeoutMs);
    const merged = mergeSignals(signal, controller.signal);
    let response;
    try {
      response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: merged,
      });
    } catch (error) {
      clear();
      if (timedOut()) {
        throw new OllamaError(
          ERROR_CODES.TIMEOUT,
          `Stream request timed out after ${this.timeoutMs}ms`,
          { cause: error },
        );
      }
      if (error && error.name === "AbortError") throw error; // caller aborted
      this.log("error", "Stream connection failed", {
        message: this._safe(error),
        duration_ms: Date.now() - startedAt,
      });
      throw new OllamaError(ERROR_CODES.OLLAMA_UNAVAILABLE, this._safe(error), {
        cause: error,
      });
    }

    if (!response.ok) {
      clear();
      const raw = await response.text().catch(() => "");
      this._logResponseFailure("stream", response.status, startedAt, raw);
      if (timedOut()) {
        throw new OllamaError(
          ERROR_CODES.TIMEOUT,
          `Stream request timed out after ${this.timeoutMs}ms`,
        );
      }
      if (response.status === 404) {
        throw new OllamaError(
          ERROR_CODES.MODEL_NOT_FOUND,
          `Model "${this.model}" not found on the Ollama server`,
        );
      }
      if (response.status === 400 || response.status === 422) {
        throw new OllamaError(
          ERROR_CODES.BAD_REQUEST,
          `Ollama rejected the stream request (status ${response.status}): ${raw}`,
        );
      }
      throw new OllamaError(
        ERROR_CODES.GENERAL,
        `Ollama stream request failed with status ${response.status}: ${raw}`,
      );
    }

    const reader = response.body && response.body.getReader();
    if (!reader) {
      clear();
      throw new OllamaError(
        ERROR_CODES.GENERAL,
        "Ollama returned no readable stream body",
      );
    }
    const decoder = new TextDecoder();

    const processLines = (buffer) => {
      const events = [];
      let lineEnd;
      while ((lineEnd = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, lineEnd).trim();
        buffer = buffer.slice(lineEnd + 1);
        if (!line) continue;
        let frame;
        try {
          frame = JSON.parse(line);
        } catch {
          continue;
        }
        const piece =
          typeof frame?.message?.content === "string"
            ? frame.message.content
            : "";
        if (piece) events.push({ type: "content", content: piece });
        if (frame?.done === true) events.push({ type: "done", done: true });
      }
      return { buffer, events };
    };

    try {
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const result = processLines(buffer);
        buffer = result.buffer;
        for (const event of result.events) yield event;
      }
      buffer += decoder.decode();
      const result = processLines(buffer);
      for (const event of result.events) yield event;
    } catch (error) {
      if (timedOut()) {
        throw new OllamaError(
          ERROR_CODES.TIMEOUT,
          `Stream read timed out after ${this.timeoutMs}ms`,
          { cause: error },
        );
      }
      if (error && error.isOllamaError) throw error;
      if (error && error.name === "AbortError") throw error; // caller aborted
      throw new OllamaError(ERROR_CODES.GENERAL, this._safe(error), {
        cause: error,
      });
    } finally {
      clear();
      this.log("info", "Stream completed", {
        model: this.model,
        duration_ms: Date.now() - startedAt,
      });
    }
  },

  /* Internal: a boxed timeout that reports whether the timer was the aborter. */
  _timeoutBox(timeoutMs) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    return {
      controller,
      timedOut: () => timedOut,
      clear: () => clearTimeout(timer),
    };
  },
};

module.exports = {
  ollamaService,
  OllamaError,
  ERROR_CODES,
  USER_MESSAGES,
  HTTP_STATUS,
};
