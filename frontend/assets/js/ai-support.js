/* AI Assistant floating conversational widget. */
(() => {
  if (window.__aiSupportLoaded) return;
  if (!document.body) {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        const script = document.createElement("script");
        script.src = "/assets/js/ai-support.js?v=29";
        document.head.appendChild(script);
      },
      { once: true },
    );
    return;
  }
  window.__aiSupportLoaded = true;

  /* api-config.js is the sole source of the backend URL. */
  const API_BASE_RESOLVED = typeof API_BASE === "string" ? API_BASE : "";
  if (!API_BASE_RESOLVED) {
    console.error(
      "[ai-support] API_BASE is unavailable; load api-config.js first.",
    );
    window.__aiSupportLoaded = false;
    return;
  }

  const fetchWithTimeout = async (url, options = {}, timeoutMs = 15000) => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      window.clearTimeout(timeoutId);
    }
  };

  const chatRequestError = (error, timedOut = false) => {
    if (error?.name === "AbortError") {
      return timedOut
        ? "The AI request timed out. Please try again."
        : "Generation stopped. You can try again.";
    }
    if (error instanceof TypeError || error?.name === "NetworkError") {
      let backend = API_BASE_RESOLVED;
      try {
        backend = new URL(API_BASE_RESOLVED).origin;
      } catch (_) {}
      console.error(
        `[ai-support] Chat request could not reach ${backend}. The backend may be unavailable or the browser may have blocked the request (CORS/network).`,
        error,
      );
      return `Cannot reach the Master AI backend at ${backend}. The service may be unavailable or the browser may have blocked the request (CORS/network). Please try again later.`;
    }
    return error?.message || "Sorry, I couldn't process that request.";
  };

  const create = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const escapeHtml = (value) =>
    String(value).replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[char],
    );
  const renderText = (text) =>
    escapeHtml(text)
      .replace(/```([\s\S]*?)```/g, "<pre><code>$1</code></pre>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/^### (.+)$/gm, "<h5>$1</h5>")
      .replace(/^## (.+)$/gm, "<h4>$1</h4>")
      .replace(/^# (.+)$/gm, "<h3>$1</h3>")
      .replace(/^[-*] (.+)$/gm, "<li>$1</li>")
      .replace(/((?:<li>.*<\/li>\n?)+)/g, "<ul>$1</ul>")
      .replace(/\n{2,}/g, "</p><p>")
      .replace(/\n/g, "<br>");

  const button = create("button", "ai-support-launcher");
  button.type = "button";
  button.setAttribute("aria-label", "Open Master AI chat");
  button.setAttribute("aria-expanded", "false");
  button.innerHTML =
    '<span class="ai-support-sparkle" aria-hidden="true"><i class="bi bi-stars"></i></span><span>✨ Master AI</span>';

  const panel = create("section", "ai-support-panel");
  panel.setAttribute("aria-label", "Master AI chat");
  panel.setAttribute("aria-hidden", "true");
  panel.innerHTML = `
    <header class="ai-support-header">
      <div class="ai-support-title-wrap">
        <span class="ai-support-avatar" aria-hidden="true"><i class="bi bi-stars"></i></span>
        <div><strong>Master AI</strong><span class="ai-support-status"><i></i> Ready to help</span></div>
      </div>
      <button type="button" class="ai-support-close" aria-label="Close AI Support"><i class="bi bi-x-lg"></i></button>
    </header>
    <div class="ai-support-intro"><strong>How can I help?</strong><span>Ask about this system’s roles and workflows, or ask a general question.</span></div>
    <div class="ai-support-suggestions" aria-label="Suggested questions"></div>
    <div class="ai-support-messages" role="log" aria-live="polite" aria-label="AI support conversation"></div>
    <div class="ai-support-attachments" id="aiSupportAttachments"></div>
    <div class="ai-support-file-status" id="aiSupportFileStatus" aria-live="polite"></div>
    <form class="ai-support-form">
      <label class="visually-hidden" for="aiSupportInput">Ask AI Support</label>
      <textarea id="aiSupportInput" rows="2" maxlength="4000" placeholder="Ask a question..." required></textarea>
      <input id="aiSupportFileInput" type="file" hidden multiple />
      <div class="ai-support-form-footer">
        <button type="button" class="ai-support-clear"><i class="bi bi-arrow-counterclockwise"></i><span>Clear</span></button>
        <button type="button" class="ai-support-new-chat">New chat</button>
        <button type="button" class="ai-support-attach"><i class="bi bi-paperclip"></i><span>Attach</span></button>
        <button type="button" class="ai-support-stop" hidden>Stop</button>
        <span class="ai-support-hint">Enter to send</span>
        <button type="submit" class="ai-support-send"><span>Send</span><i class="bi bi-arrow-up" aria-hidden="true"></i></button>
      </div>
    </form>`;

  document.body.append(button, panel);
  const messages = panel.querySelector(".ai-support-messages");
  const form = panel.querySelector(".ai-support-form");
  const input = panel.querySelector("#aiSupportInput");
  const send = panel.querySelector(".ai-support-send");
  const attach = panel.querySelector(".ai-support-attach");
  const fileInput = panel.querySelector("#aiSupportFileInput");
  const stop = panel.querySelector(".ai-support-stop");
  const clear = panel.querySelector(".ai-support-clear");
  const close = panel.querySelector(".ai-support-close");
  const newChat = panel.querySelector(".ai-support-new-chat");
  const suggestions = panel.querySelector(".ai-support-suggestions");
  const conversation = [];
  const MAX_FILES = 5;
  const MAX_TOTAL_FILE_BYTES = 10 * 1024 * 1024;
  const ALLOWED_EXTENSIONS = new Set(
    "pdf docx txt md csv xlsx pptx png jpg jpeg webp json xml yaml yml html htm css js mjs cjs ts tsx jsx py java c h cpp hpp cs go rs php rb sh bat sql toml ini log".split(
      " ",
    ),
  );
  let conversationId = null;
  let restoredConversation = false;
  let pendingFiles = [];
  let activeController = null;
  let inFlight = false;

  try {
    conversationId = sessionStorage.getItem("ict_master_ai_conversation");
  } catch (_) {}

  const setFileStatus = (message = "") => {
    const status = panel.querySelector("#aiSupportFileStatus");
    if (status) status.textContent = message;
  };
  const renderPendingFiles = () => {
    const container = panel.querySelector("#aiSupportAttachments");
    if (!container) return;
    container.replaceChildren();
    pendingFiles.forEach((file, index) => {
      const item = create("span", "ai-support-attachment", file.name);
      const remove = create("button", "ai-support-attachment-remove", "Remove");
      remove.type = "button";
      remove.addEventListener("click", () => {
        pendingFiles.splice(index, 1);
        renderPendingFiles();
      });
      item.appendChild(remove);
      container.appendChild(item);
    });
  };
  const readFileAsAttachment = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = String(reader.result || "").split(",", 2)[1];
        if (!base64) return reject(new Error("Unable to read this file."));
        resolve({
          name: file.name,
          type: file.type || "application/octet-stream",
          data: `data:${file.type || "application/octet-stream"};base64,${base64}`,
        });
      };
      reader.onerror = () => reject(new Error("Unable to read this file."));
      reader.readAsDataURL(file);
    });
  const saveConversationId = (id) => {
    conversationId = id || null;
    try {
      if (conversationId)
        sessionStorage.setItem("ict_master_ai_conversation", conversationId);
      else sessionStorage.removeItem("ict_master_ai_conversation");
    } catch (_) {}
  };
  const deleteConversation = async (id) => {
    if (!id) return;
    try {
      await fetchWithTimeout(
        `${API_BASE_RESOLVED}/ai/conversation/${encodeURIComponent(id)}`,
        { method: "DELETE", credentials: "include" },
      );
    } catch (_) {}
  };

  /* The following orphaned duplicate submit block was left outside a function
     during a previous merge. The real async handler is defined below. */
  /*
    if (!message || inFlight) return;
    const selectedFiles = pendingFiles.slice();
    inFlight = true;
    send.disabled = true;
    attach.disabled = true;
    fileInput.disabled = true;
    stop.hidden = false;
    const visibleMessage = selectedFiles.length
      ? `${message}\n\nAttached: ${selectedFiles.map((file) => file.name).join(", ")}`
      : message;
    addMessage(visibleMessage, "user");
    conversation.push({ role: "user", content: message });
    input.value = "";
    const thinking = addMessage(
      selectedFiles.length ? "Analyzing your file..." : "AI is thinking...",
      "ai thinking",
    );
    const controller = new AbortController();
    activeController = controller;
    const timeoutId = setTimeout(() => controller.abort(), 150000);
    let streamed = null;

    try {
      if (selectedFiles.length) setFileStatus("Analyzing your file...");
      const attachments = await Promise.all(selectedFiles.map(readFileAsAttachment));
      const response = await fetch(`${API_BASE_RESOLVED}/ai/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          message,
          conversationId,
          conversation: conversation.slice(0, -1),
          attachments,
          stream: true,
          context: currentPageContext(),
        }),
        signal: controller.signal,
      });

      const contentType = response.headers.get("content-type") || "";
      const isStream = response.ok && contentType.includes("text/event-stream");
      if (isStream) {
        if (!response.body) throw new Error("The AI service returned no stream.");
        thinking.remove();
        streamed = makeAiBubble();
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let answer = "";
        let receivedDone = false;
        const processFrames = () => {
          let cursor;
          while ((cursor = buffer.indexOf("\n\n")) >= 0) {
            const frame = buffer.slice(0, cursor);
            buffer = buffer.slice(cursor + 2);
            const payload = frame.split("\n").map((line) => line.trim())
              .filter((line) => line.startsWith("data: ")).map((line) => line.slice(6)).join("");
            if (!payload) continue;
            let event;
            try { event = JSON.parse(payload); } catch { continue; }
            if (event?.content) {
              answer += event.content;
              streamed.set(answer);
            }
            if (event?.error) throw new Error(event.error);
            if (event?.done === true) {
              saveConversationId(event.conversationId || conversationId);
              receivedDone = true;
            }
          }
        };
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          processFrames();
        }
        buffer += decoder.decode();
        processFrames();
        if (!answer.trim() && !receivedDone) throw new Error("The AI returned an empty response.");
        answer = answer.trim();
        streamed.set(answer);
        conversation.push({ role: "assistant", content: answer });
        addActions(streamed.bubble, answer, message);
      } else {
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.message || "Sorry, I couldn't process that request.");
        const answer = result?.data?.message || result?.message;
        if (typeof answer !== "string" || !answer.trim()) throw new Error("The AI returned an empty response.");
        thinking.remove();
        saveConversationId(result.conversationId || conversationId);
        conversation.push({ role: "assistant", content: answer });
        addMessage(answer, "ai", message);
      }
      pendingFiles = pendingFiles.filter((file) => !selectedFiles.includes(file));
      renderPendingFiles();
      setFileStatus();
    } catch (error) {
      thinking.remove();
      conversation.pop();
      const messageText =
        error?.name === "AbortError"
          ? "Generation stopped. You can try again."
          : error?.message || "Sorry, I couldn't process that request.";
      if (selectedFiles.length) setFileStatus(messageText);
      if (streamed) {
        streamed.set(messageText);
        addErrorActions(streamed.bubble, message);
      } else {
        addErrorActions(addMessage(messageText, "ai error"), message);
      }
    } finally {
      clearTimeout(timeoutId);
      activeController = null;
      inFlight = false;
      send.disabled = false;
      attach.disabled = false;
      fileInput.disabled = false;
      stop.hidden = true;
      input.focus();
    }
    );
    const unsupported = incoming.some(
      (file) =>
        !ALLOWED_EXTENSIONS.has(file.name.toLowerCase().split(".").pop()),
    );
    if (pendingFiles.length + incoming.length > MAX_FILES) {
      setFileStatus(`Choose up to ${MAX_FILES} files.`);
      return;
    }
    if (totalBytes > MAX_TOTAL_FILE_BYTES) {
      setFileStatus("Attachments must total 10 MB or less.");
      return;
    }
    if (unsupported) {
      setFileStatus(
        "Unable to read this file. Please try another supported file.",
      );
      return;
    }
    pendingFiles.push(...incoming);
    setFileStatus();
    renderPendingFiles();
  });
  attach.addEventListener("click", () => fileInput.click());
  stop.addEventListener("click", () => activeController?.abort());
  */

  fileInput.addEventListener("change", () => {
    const incoming = [...(fileInput.files || [])];
    fileInput.value = "";
    const totalBytes = [...pendingFiles, ...incoming].reduce(
      (sum, file) => sum + file.size,
      0,
    );
    const unsupported = incoming.some(
      (file) =>
        !ALLOWED_EXTENSIONS.has(file.name.toLowerCase().split(".").pop()),
    );
    if (pendingFiles.length + incoming.length > MAX_FILES) {
      setFileStatus(`Choose up to ${MAX_FILES} files.`);
      return;
    }
    if (totalBytes > MAX_TOTAL_FILE_BYTES) {
      setFileStatus("Attachments must total 10 MB or less.");
      return;
    }
    if (unsupported) {
      setFileStatus(
        "Unable to read this file. Please try another supported file.",
      );
      return;
    }
    pendingFiles.push(...incoming);
    setFileStatus();
    renderPendingFiles();
  });
  attach.addEventListener("click", () => fileInput.click());
  stop.addEventListener("click", () => activeController?.abort());

  const currentPageContext = () => {
    const collect = (selector) =>
      [...document.querySelectorAll(selector)]
        .map((item) =>
          (item.innerText || item.getAttribute("aria-label") || "")
            .replace(/\s+/g, " ")
            .trim(),
        )
        .filter(Boolean)
        .slice(0, 12)
        .join(" | ")
        .slice(0, 600);
    return {
      page: location.pathname,
      pageTitle: document.title,
      headings: collect("h1, h2, h3"),
      controls: collect("button, [role=button]"),
      language: document.documentElement.lang === "am" ? "am" : "en",
    };
  };
  const suggestedQuestions = [
    "How does a requester submit and track a maintenance ticket?",
    "Which system actions are restricted to ICT Admins?",
    "My computer is running very slowly. What should I check?",
    "My Wi-Fi is connected but there is no internet.",
    "How do I fix a printer that is not printing?",
    "Explain why the sky is blue.",
    "Write a short email asking my teacher for an extension.",
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

  const addMessage = (text, type, question) => {
    const bubble = create("div", `ai-support-message ${type}`);
    if (type.startsWith("ai")) {
      const avatar = create("span", "ai-support-message-avatar");
      avatar.innerHTML = '<i class="bi bi-stars" aria-hidden="true"></i>';
      bubble.appendChild(avatar);
    }
    const content = create("div", "ai-support-message-content");
    if (type === "ai") content.innerHTML = `<p>${renderText(text)}</p>`;
    else content.textContent = text;
    bubble.appendChild(content);
    messages.appendChild(bubble);
    messages.scrollTop = messages.scrollHeight;
    if (type === "ai" && question) {
      const actions = create("div", "ai-support-actions");
      const copy = create("button", "ai-support-action", "Copy");
      const regenerate = create("button", "ai-support-action", "Regenerate");
      copy.type = regenerate.type = "button";
      copy.addEventListener("click", () =>
        navigator.clipboard?.writeText(text),
      );
      regenerate.addEventListener("click", () => submitQuestion(question));
      actions.append(copy, regenerate);
      bubble.appendChild(actions);
    }
    return bubble;
  };

  const makeAiBubble = () => {
    const bubble = create("div", "ai-support-message ai");
    const avatar = create("span", "ai-support-message-avatar");
    avatar.innerHTML = '<i class="bi bi-stars" aria-hidden="true"></i>';
    const content = create("div", "ai-support-message-content");
    bubble.append(avatar, content);
    messages.appendChild(bubble);
    return {
      bubble,
      set(text) {
        content.innerHTML = `<p>${renderText(text)}</p>`;
        messages.scrollTop = messages.scrollHeight;
      },
    };
  };
  const addActions = (bubble, text, question) => {
    const actions = create("div", "ai-support-actions");
    const copy = create("button", "ai-support-action", "Copy");
    const regenerate = create("button", "ai-support-action", "Regenerate");
    copy.type = regenerate.type = "button";
    copy.addEventListener("click", () => navigator.clipboard?.writeText(text));
    regenerate.addEventListener("click", () => submitQuestion(question));
    actions.append(copy, regenerate);
    bubble.appendChild(actions);
  };
  const addErrorActions = (bubble, question) => {
    if (bubble.querySelector(".ai-support-actions")) return;
    const actions = create("div", "ai-support-actions");
    const retry = create("button", "ai-support-action", "Retry");
    retry.type = "button";
    retry.addEventListener("click", () => submitQuestion(question));
    actions.append(retry);
    bubble.appendChild(actions);
  };

  const restoreConversation = async () => {
    if (restoredConversation) return conversation.length > 0;
    restoredConversation = true;
    if (!conversationId) return false;
    try {
      const response = await fetchWithTimeout(
        `${API_BASE_RESOLVED}/ai/conversation/${encodeURIComponent(conversationId)}`,
        { credentials: "include" },
      );
      if (!response.ok) {
        saveConversationId(null);
        return false;
      }
      const result = await response.json();
      const history = Array.isArray(result.messages) ? result.messages : [];
      if (!history.length) return false;
      conversation.push(...history);
      messages.replaceChildren();
      history.forEach((item, index) => {
        if (item.role === "assistant") {
          const question =
            history[index - 1]?.role === "user"
              ? history[index - 1].content
              : "";
          const bubble = addMessage(item.content, "ai", question);
          if (!question) messages.appendChild(bubble);
        } else {
          addMessage(item.content, "user");
        }
      });
      return history.length > 0;
    } catch (_) {
      return false;
    }
  };

  const resetConversation = () => {
    const oldId = conversationId;
    activeController?.abort();
    void deleteConversation(oldId);
    conversation.length = 0;
    saveConversationId(null);
    pendingFiles = [];
    renderPendingFiles();
    setFileStatus();
    messages.replaceChildren();
    showWelcome();
    input.focus();
  };

  const showWelcome = () => {
    if (!messages.children.length)
      addMessage(
        "Hi! I’m Master AI, here to help with the Smart ICT Maintenance Management System and general questions. For project questions, I’ll use verified system information and tell you when I don’t have enough context.",
        "ai",
      );
  };
  const setOpen = (open) => {
    panel.classList.toggle("is-open", open);
    panel.setAttribute("aria-hidden", String(!open));
    button.setAttribute("aria-expanded", String(open));
    if (open) {
      restoreConversation().then((restored) => {
        if (!restored) showWelcome();
      });
      window.setTimeout(() => input.focus(), 80);
    }
  };
  button.addEventListener("click", () =>
    setOpen(!panel.classList.contains("is-open")),
  );
  close.addEventListener("click", () => setOpen(false));
  clear.addEventListener("click", resetConversation);
  newChat.addEventListener("click", resetConversation);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && panel.classList.contains("is-open")) {
      setOpen(false);
      button.focus();
    }
  });

  async function submitQuestion(message) {
    if (!message || inFlight) return;
    const selectedFiles = pendingFiles.slice();
    inFlight = true;
    send.disabled = true;
    attach.disabled = true;
    fileInput.disabled = true;
    stop.hidden = false;
    const userText = selectedFiles.length
      ? `${message}\n\nAttached: ${selectedFiles.map((file) => file.name).join(", ")}`
      : message;
    addMessage(userText, "user");
    conversation.push({ role: "user", content: message });
    input.value = "";
    const thinking = addMessage(
      selectedFiles.length ? "Analyzing your file..." : "AI is thinking...",
      "ai thinking",
    );
    const controller = new AbortController();
    activeController = controller;
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 150000);
    let streamed = null;
    try {
      if (selectedFiles.length) setFileStatus("Analyzing your file...");
      const attachments = await Promise.all(
        selectedFiles.map(readFileAsAttachment),
      );
      const response = await fetch(`${API_BASE_RESOLVED}/ai/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          message,
          conversationId,
          conversation: conversation.slice(0, -1),
          attachments,
          stream: true,
          context: currentPageContext(),
        }),
        signal: controller.signal,
      });
      const contentType = response.headers.get("content-type") || "";
      const isStream = response.ok && contentType.includes("text/event-stream");
      if (isStream) {
        if (!response.body)
          throw new Error("The AI service returned no stream.");
        thinking.remove();
        streamed = makeAiBubble();
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let answer = "";
        let receivedDone = false;
        const processFrames = () => {
          let cursor;
          while ((cursor = buffer.indexOf("\n\n")) >= 0) {
            const frame = buffer.slice(0, cursor);
            buffer = buffer.slice(cursor + 2);
            const payload = frame
              .split("\n")
              .map((line) => line.trim())
              .filter((line) => line.startsWith("data: "))
              .map((line) => line.slice(6))
              .join("");
            if (!payload) continue;
            let event;
            try {
              event = JSON.parse(payload);
            } catch {
              continue;
            }
            if (event?.content) {
              answer += event.content;
              streamed.set(answer);
            }
            if (event?.error) throw new Error(event.error);
            if (event?.done === true) {
              saveConversationId(event.conversationId || conversationId);
              receivedDone = true;
            }
          }
        };
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          processFrames();
        }
        buffer += decoder.decode();
        processFrames();
        if (!answer.trim() && !receivedDone)
          throw new Error("The AI returned an empty response.");
        answer = answer.trim();
        streamed.set(answer);
        conversation.push({ role: "assistant", content: answer });
        addActions(streamed.bubble, answer, message);
        pendingFiles = pendingFiles.filter(
          (file) => !selectedFiles.includes(file),
        );
        renderPendingFiles();
        setFileStatus();
      } else {
        const result = await response.json().catch(() => ({}));
        if (!response.ok)
          throw new Error(result.message || "AI service request failed.");
        const answer = result?.data?.message || result?.message;
        if (typeof answer !== "string" || !answer.trim())
          throw new Error("The AI returned an empty response.");
        thinking.remove();
        saveConversationId(result.conversationId || conversationId);
        conversation.push({ role: "assistant", content: answer });
        addMessage(answer, "ai", message);
        pendingFiles = pendingFiles.filter(
          (file) => !selectedFiles.includes(file),
        );
        renderPendingFiles();
        setFileStatus();
      }
    } catch (error) {
      thinking.remove();
      conversation.pop();
      const messageText = chatRequestError(error, timedOut);
      if (selectedFiles.length) setFileStatus(messageText);
      if (streamed) {
        streamed.set(messageText);
        addErrorActions(streamed.bubble, message);
      } else {
        const bubble = addMessage(messageText, "ai error");
        addErrorActions(bubble, message);
      }
    } finally {
      clearTimeout(timeoutId);
      activeController = null;
      inFlight = false;
      send.disabled = false;
      attach.disabled = false;
      fileInput.disabled = false;
      stop.hidden = true;
      input.focus();
    }
  }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submitQuestion(input.value.trim());
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
})();
