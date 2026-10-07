const MAX_LOGGED_BODY = 300;

const ERROR_CODES = Object.freeze({
  PROVIDER_NOT_CONFIGURED: "PROVIDER_NOT_CONFIGURED",
  PROVIDER_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
  MODEL_NOT_FOUND: "MODEL_NOT_FOUND",
  TIMEOUT: "TIMEOUT",
  EMPTY_RESPONSE: "EMPTY_RESPONSE",
  BAD_REQUEST: "BAD_REQUEST",
  GENERAL: "GENERAL",
});

const USER_MESSAGES = Object.freeze({
  [ERROR_CODES.PROVIDER_NOT_CONFIGURED]:
    "AI service is not configured. Please contact the administrator.",
  [ERROR_CODES.PROVIDER_UNAVAILABLE]:
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

const HTTP_STATUS = Object.freeze({
  [ERROR_CODES.PROVIDER_NOT_CONFIGURED]: 503,
  [ERROR_CODES.PROVIDER_UNAVAILABLE]: 503,
  [ERROR_CODES.MODEL_NOT_FOUND]: 503,
  [ERROR_CODES.TIMEOUT]: 504,
  [ERROR_CODES.EMPTY_RESPONSE]: 502,
  [ERROR_CODES.BAD_REQUEST]: 400,
  [ERROR_CODES.GENERAL]: 502,
});

class AIServiceError extends Error {
  constructor(code, detail, options = {}) {
    super(
      (typeof options.overrideUserMessage === "string" &&
        options.overrideUserMessage.trim()) ||
        USER_MESSAGES[code] ||
        USER_MESSAGES[ERROR_CODES.GENERAL],
    );
    this.name = "AIServiceError";
    this.code = code;
    this.detail =
      typeof detail === "string" && detail.trim()
        ? detail.slice(0, MAX_LOGGED_BODY)
        : "unknown";
    this.status = options.status || HTTP_STATUS[code] || 502;
    this.isAIServiceError = true;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

module.exports = { AIServiceError, ERROR_CODES, USER_MESSAGES, HTTP_STATUS };
