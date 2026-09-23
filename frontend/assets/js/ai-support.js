/* AI ICT Support floating advisory assistant. */
(() => {
  if (window.__aiSupportLoaded) return;
  if (!document.body) {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        const script = document.createElement("script");
        script.src = "/assets/js/ai-support.js?v=5";
        document.head.appendChild(script);
      },
      { once: true },
    );
    return;
  }
  window.__aiSupportLoaded = true;
  const create = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  };

  const button = create("button", "ai-support-launcher");
  button.type = "button";
  button.setAttribute("aria-label", "Open AI Support chat");
  button.setAttribute("aria-expanded", "false");
  button.innerHTML =
    '<span class="ai-support-sparkle" aria-hidden="true"><i class="bi bi-stars"></i></span><span>AI Support</span>';

  const panel = create("section", "ai-support-panel");
  panel.setAttribute("aria-label", "AI Support chat");
  panel.setAttribute("aria-hidden", "true");
  panel.innerHTML = `
    <header class="ai-support-header">
      <div class="ai-support-title-wrap">
        <span class="ai-support-avatar" aria-hidden="true"><i class="bi bi-stars"></i></span>
        <div><strong>AI Support</strong><span class="ai-support-status"><i></i> Ready to help</span></div>
      </div>
      <button type="button" class="ai-support-close" aria-label="Close AI Support"><i class="bi bi-x-lg"></i></button>
    </header>
    <div class="ai-support-intro">
      <strong>How can I help?</strong>
      <span>Ask about ICT maintenance, everyday technology, or a general question.</span>
    </div>
    <div class="ai-support-suggestions" aria-label="Suggested questions"></div>
    <div class="ai-support-messages" role="log" aria-live="polite" aria-label="AI support conversation"></div>
    <form class="ai-support-form">
      <label class="visually-hidden" for="aiSupportInput">Ask AI Support</label>
      <textarea id="aiSupportInput" rows="2" maxlength="4000" placeholder="Ask a question..." required></textarea>
      <div class="ai-support-form-footer">
        <button type="button" class="ai-support-clear"><i class="bi bi-arrow-counterclockwise"></i><span>Clear</span></button>
        <span class="ai-support-hint">Enter to send</span>
        <button type="submit" class="ai-support-send"><span>Send</span><i class="bi bi-arrow-up" aria-hidden="true"></i></button>
      </div>
    </form>`;

  document.body.append(button, panel);
  const messages = panel.querySelector(".ai-support-messages");
  const form = panel.querySelector(".ai-support-form");
  const input = panel.querySelector("#aiSupportInput");
  const send = panel.querySelector(".ai-support-send");
  const clear = panel.querySelector(".ai-support-clear");
  const close = panel.querySelector(".ai-support-close");
  const suggestions = panel.querySelector(".ai-support-suggestions");
  const conversation = [];
  let inFlight = false;
  const suggestedQuestions = [
    "My computer is running very slowly. What should I check?",
    "My Wi-Fi is connected but there is no internet.",
    "How do I fix a printer that is not printing?",
    "How can I check my computer's specifications?",
    "My Windows computer won't start. What should I do?",
    "How do I troubleshoot a network connection?",
    "How can I protect my computer from malware?",
  ];

  suggestedQuestions.forEach((question) => {
    const suggestion = create("button", "ai-support-suggestion", question);
    suggestion.type = "button";
    suggestion.addEventListener("click", () => {
      input.value = question;
      input.focus();
    });
    suggestions.appendChild(suggestion);
  });
  const addMessage = (text, type) => {
    const bubble = create("div", `ai-support-message ${type}`);
    if (type === "ai") {
      const avatar = create("span", "ai-support-message-avatar");
      avatar.innerHTML = '<i class="bi bi-stars" aria-hidden="true"></i>';
      bubble.appendChild(avatar);
    }
    bubble.appendChild(create("span", "ai-support-message-content", text));
    messages.appendChild(bubble);
    messages.scrollTop = messages.scrollHeight;
    return bubble;
  };

  const showWelcome = () => {
    if (!messages.children.length) {
      addMessage(
        "Hi, I’m your AI Support assistant. I can help with ICT troubleshooting, everyday technology, and general questions. What would you like to work through?",
        "ai",
      );
    }
  };

  const setOpen = (open) => {
    panel.classList.toggle("is-open", open);
    panel.setAttribute("aria-hidden", String(!open));
    button.setAttribute("aria-expanded", String(open));
    if (open) {
      showWelcome();
      window.setTimeout(() => input.focus(), 80);
    }
  };

  button.addEventListener("click", () => {
    if (panel.classList.contains("is-open")) {
      input.focus();
      return;
    }
    setOpen(true);
  });
  close.addEventListener("click", () => setOpen(false));
  clear.addEventListener("click", () => {
    conversation.length = 0;
    messages.replaceChildren();
    showWelcome();
    input.focus();
  });

  const FALLBACK_ERROR_MESSAGE =
    "AI Support is temporarily unavailable right now. Please try again later or submit an ICT maintenance request.";

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = input.value.trim();
    if (!message || send.disabled || inFlight) return;

    addMessage(message, "user");
    conversation.push({ role: "user", content: message });
    input.value = "";
    inFlight = true;
    send.disabled = true;
    const thinking = addMessage("AI is thinking...", "ai thinking");
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 30000);

    try {
      const token = localStorage.getItem("ict_token");
      const headers = { "Content-Type": "application/json" };
      if (token) headers.Authorization = `Bearer ${token}`;
      const response = await fetch(`${API_BASE}/ai-support`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          message,
          conversation: conversation.slice(0, -1),
          context: { page: window.location.pathname },
        }),
        signal: controller.signal,
      });
      const result = await response.json().catch(() => ({}));
      thinking.remove();
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(
            "AI Support is not available on the current backend deployment. Please try again later.",
          );
        }
        if (response.status === 401) {
          throw new Error("Please sign in to use AI Support.");
        }
        if (response.status === 403) {
          throw new Error("Your account cannot use AI Support right now.");
        }
        if (response.status === 503 && result.message) {
          throw new Error(result.message);
        }
        if (response.status === 422 && result.message) {
          throw new Error(result.message);
        }
        console.error(
          `[AI Support] Request failed: ${response.status} ${response.statusText}`,
          result?.message || "",
        );
        throw new Error(FALLBACK_ERROR_MESSAGE);
      }
      if (!result.success || typeof result.data?.message !== "string") {
        console.error(
          "[AI Support] Unexpected response body. HTTP",
          response.status,
          "fields:",
          result && typeof result === "object" ? Object.keys(result) : result,
        );
        throw new Error(FALLBACK_ERROR_MESSAGE);
      }
      conversation.push({ role: "assistant", content: result.data.message });
      addMessage(result.data.message, "ai");
    } catch (error) {
      thinking.remove();
      if (
        conversation.length &&
        conversation[conversation.length - 1].role === "user"
      ) {
        conversation.pop();
      }
      if (error && error.name === "AbortError") {
        console.error(
          "[AI Support] Request timed out after 30s.",
          "Endpoint:",
          `${API_BASE}/ai-support`,
        );
        addMessage(
          "AI Support is taking longer than expected. Please try again.",
          "ai error",
        );
      } else if (error instanceof TypeError) {
        console.error("[AI Support] Backend unreachable:", error.message);
        addMessage(
          "I can’t reach the AI service right now. Check your connection and try again.",
          "ai error",
        );
      } else {
        console.error("[AI Support] Chat error:", error?.message || error);
        addMessage(error.message || FALLBACK_ERROR_MESSAGE, "ai error");
      }
    } finally {
      window.clearTimeout(timeoutId);
      inFlight = false;
      send.disabled = false;
      input.focus();
    }
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
})();
