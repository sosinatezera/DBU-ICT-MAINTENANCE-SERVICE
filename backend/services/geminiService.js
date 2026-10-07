/**
 * services/geminiService.js
 * Gemini provider for the Master AI system — a genuinely FREE hosted provider
 * for production (Google AI Studio free-tier API key, no credit card). The
 * API key lives ONLY in backend environment variables; it is never exposed to
 * the browser or returned by any endpoint.
 *
 * Gemini AI Studio Free Tier is the sole inference provider. The API key is
 * sent only in Google's x-goog-api-key request header and never in a URL.
 *
 * Handles model reachability, generation, streaming, abort-safe timeouts,
 * normalized errors, and backend-only logging with credential redaction.
 *
 * Friendly user messages are returned in error.message; technical detail is
 * kept in error.detail and logged here — internal endpoints and the API key
 * never reach the UI.
 */

const env = require("../config/env");
const { AIServiceError, ERROR_CODES } = require("./aiError");

const MAX_LOGGED_BODY = 300;

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

/* Identify the image mime type from its raw base64 bytes so it can be sent to
   Gemini as inline_data. Attachments are restricted to png/jpg/jpeg/webp. */
function sniffImageMime(base64) {
  try {
    const buf = Buffer.from(String(base64 || ""), "base64");
    if (
      buf.length >= 8 &&
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47
    ) {
      return "image/png";
    }
    if (
      buf.length >= 3 &&
      buf[0] === 0xff &&
      buf[1] === 0xd8 &&
      buf[2] === 0xff
    ) {
      return "image/jpeg";
    }
    if (
      buf.length >= 12 &&
      buf.toString("ascii", 0, 4) === "RIFF" &&
      buf.toString("ascii", 8, 12) === "WEBP"
    ) {
      return "image/webp";
    }
  } catch (_) {
    /* fall through */
  }
  return "image/png";
}

const geminiService = {
/* ── Configuration (centralized here — reads env, never hard-codes) ── */
  get baseUrl() {
    return env.GEMINI_BASE_URL;
  },
  get model() {
    return (env.GEMINI_MODEL || "gemini-3.5-flash-lite").trim();
  },
  get apiKey() {
    return String(env.GEMINI_API_KEY || "").trim();
  },
  get timeoutMs() {
    return Number(env.GEMINI_TIMEOUT_MS) || 120000;
  },
  get pingTimeoutMs() {
    return Number(env.GEMINI_PING_TIMEOUT_MS) || 10000;
  },
  get maxTokens() {
    const value = Number(env.GEMINI_MAX_TOKENS);
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
    fn(`[Master AI][Gemini] ${message}${suffix}`);
  },

  _safe(error) {
    return this._redactSecret(
      String((error && error.message) || error || "unknown error"),
    ).slice(0, MAX_LOGGED_BODY);
  },

  _redactSecret(value) {
    return this.apiKey
      ? String(value).split(this.apiKey).join("[redacted]")
      : String(value);
  },

  _endpoint(action, stream) {
    const model = encodeURIComponent(geminiService.model);
    const query = stream ? "?alt=sse" : "";
    return `${geminiService.baseUrl}/models/${model}:${action}${query}`;
  },

  _importConfigured() {
    if (!geminiService.apiKey) {
      throw new AIServiceError(
        ERROR_CODES.PROVIDER_NOT_CONFIGURED,
        "GEMINI_API_KEY is not configured",
      );
    }
    return geminiService.apiKey;
  },

  /* Map a Gemini HTTP status into a stable, friendly AIServiceError. */
  _errorFromResponse(phase, status, rawBody, startedAt) {
    let message = "";
    try {
      const parsed = JSON.parse(String(rawBody || "{}"));
      message = this._redactSecret(
        String(parsed?.error?.message || ""),
      ).slice(0, MAX_LOGGED_BODY);
    } catch {
      message = this._redactSecret(String(rawBody || "")).slice(
        0,
        MAX_LOGGED_BODY,
      );
    }
    this.log("error", `${phase} request failed`, {
      status,
      model: this.model,
      duration_ms: Date.now() - startedAt,
      code: message,
    });
    if (status === 400 && /api key not valid/i.test(message)) {
      return new AIServiceError(
        ERROR_CODES.PROVIDER_NOT_CONFIGURED,
        "Google rejected GEMINI_API_KEY as invalid",
      );
    }
    if (status === 400 || status === 422) {
      return new AIServiceError(
        ERROR_CODES.BAD_REQUEST,
        `Gemini rejected the request (status ${status}): ${message}`,
      );
    }
    if (status === 401 || status === 403) {
      return new AIServiceError(
        ERROR_CODES.PROVIDER_NOT_CONFIGURED,
        `Gemini auth failed (status ${status}): ${message}`,
      );
    }
    if (status === 404) {
      return new AIServiceError(
        ERROR_CODES.MODEL_NOT_FOUND,
        `Model "${this.model}" not found on the Gemini provider`,
      );
    }
    if (status === 429 || status >= 500) {
      return new AIServiceError(
        ERROR_CODES.PROVIDER_UNAVAILABLE,
        `Gemini request failed with status ${status}: ${message}`,
      );
    }
    return new AIServiceError(
      ERROR_CODES.GENERAL,
      `Gemini request failed with status ${status}: ${message}`,
    );
  },

  /* ── Connectivity / model availability ── */

  /**
   * Reachability check (GET /models with the configured key). Never throws —
   * callers get a normalized result. Used by the health endpoints and stream
   * preflight. The key is never included in the returned object.
   */
  async ping({ signal } = {}) {
    const startedAt = Date.now();
    if (!this.apiKey) {
      this.log("error", "Provider key is not configured");
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
      response = await fetch(
        `${this.baseUrl}/models`,
        {
          headers: { "x-goog-api-key": this.apiKey },
          signal: merged,
        },
      );
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
      return { ok: false, status: response.status, latencyMs, timedOut: false };
    }
    this.log("info", "Ping succeeded", {
      status: response.status,
      duration_ms: latencyMs,
    });
    return { ok: true, status: response.status, latencyMs, timedOut: false };
  },

  /**
   * List model names the key can access (normalized, "models/" prefix
   * stripped). Never throws.
   */
  async listModels({ signal } = {}) {
    if (!this.apiKey) return [];
    const { controller, timedOut, clear } = this._timeoutBox(
      this.pingTimeoutMs,
    );
    const merged = mergeSignals(signal, controller.signal);
    try {
      const response = await fetch(
        `${this.baseUrl}/models`,
        {
          headers: { "x-goog-api-key": this.apiKey },
          signal: merged,
        },
      );
      clear();
      if (!response.ok) {
        this.log("error", "Models fetch failed", {
          status: response.status,
          timedOut: timedOut(),
        });
        return [];
      }
      const data = await response.json().catch(() => ({}));
      const models = Array.isArray(data.models)
        ? data.models
            .filter(
              (model) =>
                Array.isArray(model?.supportedGenerationMethods) &&
                model.supportedGenerationMethods.includes("generateContent"),
            )
            .map((model) =>
              typeof model?.name === "string"
                ? model.name.replace(/^models\//, "")
                : "",
            )
            .filter(Boolean)
        : [];
      this.log("info", "Models fetched", {
        count: models.length,
      });
      return models;
    } catch (error) {
      clear();
      this.log("error", "Models fetch failed", {
        message: this._safe(error),
      });
      return [];
    }
  },

  /* Tolerant model-name matching ("models/" prefix and tags accepted). */
  isModelAvailable(model, available = []) {
    const normalize = (name) => String(name).toLowerCase().replace(/^models\//, "");
    const needle = normalize(model || this.model);
    return (Array.isArray(available) ? available : []).some((name) => {
      const candidate = normalize(name);
      return (
        candidate === needle ||
        candidate.startsWith(`${needle}:`) ||
        needle.startsWith(`${candidate}:`)
      );
    });
  },

  async verifyModel(model, { signal } = {}) {
    const target = (typeof model === "string" && model.trim()) || this.model;
    const ping = await this.ping({ signal });
    const availableModels = ping.ok
      ? await this.listModels({ signal })
      : [];
    const modelAvailable = this.isModelAvailable(target, availableModels);
    this.log("info", "Model verified", { model: target, modelAvailable });
    return {
      ok: ping.ok && modelAvailable,
      status: ping.ok ? 200 : ping.status,
      latencyMs: ping.latencyMs,
      modelAvailable,
      model: target,
      providerConfigured: Boolean(this.apiKey),
      providerReachable: ping.ok,
    };
  },

  /* ── Payload / response helpers ── */

  _normalizeMessages(messages, images) {
    const safeMessages = (Array.isArray(messages) ? messages : []).map(
      (item) => ({ ...item }),
    );
    const latestUser = [...safeMessages]
      .reverse()
      .find((item) => item.role === "user");
    if (latestUser && Array.isArray(images) && images.length) {
      latestUser.images = [...(latestUser.images || []), ...images];
    }
    return safeMessages;
  },

  /* Translate application messages into Gemini contents (one "user" message
     may carry text + several inline_data image parts; consecutive turns of
     the same role are merged because Gemini requires alternating roles). */
  _buildPayload({ messages, system, images, maxTokens } = {}) {
    const contents = [];
    for (const item of this._normalizeMessages(messages, images)) {
      const role = item && item.role === "assistant" ? "model" : "user";
      const parts = [];
      const text = String(item?.content || "").trim();
      if (text) parts.push({ text });
      for (const image of Array.isArray(item?.images) ? item.images : []) {
        const data = String(image || "");
        if (data) {
          parts.push({
            inline_data: { mime_type: sniffImageMime(data), data },
          });
        }
      }
      if (parts.length) contents.push({ role, parts });
    }
    const merged = [];
    for (const content of contents) {
      const previous = merged[merged.length - 1];
      if (previous && previous.role === content.role) {
        previous.parts = [...previous.parts, ...content.parts];
      } else {
        merged.push({ role: content.role, parts: [...content.parts] });
      }
    }
    const payload = {};
    if (system && String(system).trim()) {
      payload.systemInstruction = { parts: [{ text: String(system) }] };
    }
    if (merged.length) payload.contents = merged;
    payload.generationConfig = {
      maxOutputTokens: maxTokens || this.maxTokens,
    };
    return payload;
  },

  /* Gather response text across all parts (skipping `thought` parts). */
  _extractFirstCandidateText(data) {
    const parts = data?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return "";
    return parts
      .filter((part) => part && part.thought !== true)
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("")
      .trim();
  },

  /* ── Chat: non-streaming ── */

  async chat({ messages, system, images, signal, maxTokens } = {}) {
    this._importConfigured();
    const body = this._buildPayload({ messages, system, images, maxTokens });
    const startedAt = Date.now();
    const { controller, timedOut, clear } = this._timeoutBox(this.timeoutMs);
    const merged = mergeSignals(signal, controller.signal);
    let response;
    try {
      response = await fetch(this._endpoint("generateContent", false), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": this.apiKey,
        },
        body: JSON.stringify(body),
        signal: merged,
      });
    } catch (error) {
      clear();
      if (timedOut()) {
        throw new AIServiceError(
          ERROR_CODES.TIMEOUT,
          `Chat request timed out after ${this.timeoutMs}ms`,
          { cause: error },
        );
      }
      if (error && error.name === "AbortError") throw error;
      this.log("error", "Chat connection failed", {
        message: this._safe(error),
        duration_ms: Date.now() - startedAt,
      });
      throw new AIServiceError(
        ERROR_CODES.PROVIDER_UNAVAILABLE,
        this._safe(error),
        { cause: error },
      );
    }
    clear();
    if (!response.ok) {
      const raw = await response.text().catch(() => "");
      throw this._errorFromResponse("chat", response.status, raw, startedAt);
    }
    const data = await response.json().catch(() => null);
    const content = this._extractFirstCandidateText(data);
    if (!content) {
      throw new AIServiceError(
        ERROR_CODES.EMPTY_RESPONSE,
        `Gemini returned no content for model "${this.model}"`,
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
   * Streaming inference (streamGenerateContent?alt=sse). Async generator that
   * yields normalized content and completion frames:
   *   { type: "content", content: "<tokens>" }
   *   { type: "done",    done: true }
   * Each SSE `data:` event is a GenerateContentResponse whose parts carry the
   * next delta. Malformed lines are skipped.
   */
  async *chatStream({ messages, system, images, signal, maxTokens } = {}) {
    this._importConfigured();
    const body = this._buildPayload({ messages, system, images, maxTokens });
    const startedAt = Date.now();
    const { controller, timedOut, clear } = this._timeoutBox(this.timeoutMs);
    const merged = mergeSignals(signal, controller.signal);
    let response;
    try {
      response = await fetch(this._endpoint("streamGenerateContent", true), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": this.apiKey,
        },
        body: JSON.stringify(body),
        signal: merged,
      });
    } catch (error) {
      clear();
      if (timedOut()) {
        throw new AIServiceError(
          ERROR_CODES.TIMEOUT,
          `Stream request timed out after ${this.timeoutMs}ms`,
          { cause: error },
        );
      }
      if (error && error.name === "AbortError") throw error;
      this.log("error", "Stream connection failed", {
        message: this._safe(error),
        duration_ms: Date.now() - startedAt,
      });
      throw new AIServiceError(
        ERROR_CODES.PROVIDER_UNAVAILABLE,
        this._safe(error),
        { cause: error },
      );
    }
    if (!response.ok) {
      clear();
      const raw = await response.text().catch(() => "");
      throw this._errorFromResponse("stream", response.status, raw, startedAt);
    }
    const reader = response.body && response.body.getReader();
    if (!reader) {
      clear();
      throw new AIServiceError(
        ERROR_CODES.GENERAL,
        "Gemini returned no readable stream body",
      );
    }

    const decoder = new TextDecoder();
    const processSSE = (buffer) => {
      const events = [];
      for (;;) {
        const crlf = buffer.indexOf("\r\n\r\n");
        const lf = buffer.indexOf("\n\n");
        let sep = -1;
        let sepLen = 0;
        if (crlf >= 0 && (lf < 0 || crlf <= lf)) {
          sep = crlf;
          sepLen = 4;
        } else if (lf >= 0) {
          sep = lf;
          sepLen = 2;
        }
        if (sep < 0) break;
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + sepLen);
        const payload = block
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line.startsWith("data: "))
          .map((line) => line.slice(6))
          .join("");
        if (!payload) continue;
        let frame;
        try {
          frame = JSON.parse(payload);
        } catch {
          continue;
        }
        const parts = frame?.candidates?.[0]?.content?.parts;
        if (Array.isArray(parts)) {
          for (const part of parts) {
            if (
              part &&
              part.thought !== true &&
              typeof part?.text === "string" &&
              part.text
            ) {
              events.push({ type: "content", content: part.text });
            }
          }
        }
      }
      return { buffer, events };
    };

    try {
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const result = processSSE(buffer);
        buffer = result.buffer;
        for (const event of result.events) yield event;
      }
      buffer += decoder.decode();
      const result = processSSE(buffer);
      for (const event of result.events) yield event;
    } catch (error) {
      if (timedOut()) {
        throw new AIServiceError(
          ERROR_CODES.TIMEOUT,
          `Stream read timed out after ${this.timeoutMs}ms`,
          { cause: error },
        );
      }
      if (error && error.isAIServiceError) throw error;
      if (error && error.name === "AbortError") throw error;
      throw new AIServiceError(ERROR_CODES.GENERAL, this._safe(error), {
        cause: error,
      });
    } finally {
      clear();
      this.log("info", "Stream completed", {
        model: this.model,
        duration_ms: Date.now() - startedAt,
      });
    }
    yield { type: "done", done: true };
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

module.exports = { geminiService };