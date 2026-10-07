/* ============================================================
   assistant.js — Dedicated Smart ICT AI Assistant page
   Talks to the backend Gemini AI service via /api/ai/chat (SSE streaming
   with a non-stream JSON fallback).
   ============================================================ */

(() => {
  if (window.__assistantPageLoaded) return;
  window.__assistantPageLoaded = true;

  const API_BASE_RESOLVED =
    typeof window.API_BASE === "string" ? window.API_BASE : "";
  if (!API_BASE_RESOLVED) {
    console.error(
      "[assistant] API_BASE is unavailable; load api-config.js first.",
    );
    window.__assistantPageLoaded = false;
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

  const chatRequestError = (error, timedOut) => {
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
        `[assistant] Chat request could not reach ${backend}. The backend may be unavailable or the browser may have blocked the request (CORS/network).`,
        error,
      );
      return `Cannot reach the Master AI backend at ${backend}. The service may be unavailable or the browser may have blocked the request (CORS/network). Please try again later.`;
    }
    return error?.message || "Sorry, I couldn't process that request.";
  };

  /* ── DOM refs ────────────────────────────────────────────── */
  const messages = document.getElementById("assistantMessages");
  const form = document.getElementById("assistantForm");
  const input = document.getElementById("assistantInput");
  const sendBtn = document.getElementById("assistantSend");
  const clearBtn = document.getElementById("assistantClear");
  const newChatBtn = document.getElementById("assistantNewChat");
  const fileInput = document.getElementById("assistantFileInput");
  const attachBtn = document.getElementById("assistantAttach");
  const stopBtn = document.getElementById("assistantStop");
  const attachmentsEl = document.getElementById("assistantAttachments");
  const attachmentStatus = document.getElementById("assistantAttachmentStatus");
  const statusText = document.getElementById("assistantStatusText");
  const notice = document.getElementById("assistantNotice");

  /* ── State ───────────────────────────────────────────────── */
  const CONVERSATION_KEY = "ict_master_ai_conversation";
  const MAX_FILES = 5;
  const MAX_TOTAL_FILE_BYTES = 10 * 1024 * 1024;
  const ALLOWED_EXTENSIONS = new Set(
    "pdf docx txt md csv xlsx pptx png jpg jpeg webp json xml yaml yml html htm css js mjs cjs ts tsx jsx py java c h cpp hpp cs go rs php rb sh bat sql toml ini log".split(
      " ",
    ),
  );
  const session = { conversation: [], conversationId: null, inFlight: false };
  let pendingFiles = [];
  let activeController = null;

  /* ── Auth (optional) ─────────────────────────────────────── */
  let authUser = null;

  /* ── Small helpers ───────────────────────────────────────── */
  const create = (tag, className, text) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  };

  const escapeHtml = (value) =>
    String(value).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );

  const renderText = (text) =>
    escapeHtml(text)
      .replace(/```([\s\S]*?)```/g, "<pre><code>$1</code></pre>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/^### (.+)$/gm, "<h5>$1</h5>")
      .replace(/^## (.+)$/gm, "<h4>$1</h4>")
      .replace(/^# (.+)$/gm, "<h3>$1</h3>")
      .replace(/^[-*] (.+)$/gm, "<li>$1</li>")
      .replace(/((?:<li>.*<\/li>\n?)+)/g, "<ul>$1</ul>")
      .replace(/\n{2,}/g, "</p><p>")
      .replace(/\n/g, "<br>");

  const nowLabel = () =>
    new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const setAttachmentStatus = (message = "") => {
    if (attachmentStatus) attachmentStatus.textContent = message;
  };

  const fileMimeType = (file) => {
    if (file.type) return file.type;
    const extension = file.name.toLowerCase().split(".").pop();
    return (
      {
        md: "text/markdown",
        csv: "text/csv",
        xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        webp: "image/webp",
      }[extension] || "application/octet-stream"
    );
  };

  const renderPendingFiles = () => {
    if (!attachmentsEl) return;
    attachmentsEl.replaceChildren();
    pendingFiles.forEach((file, index) => {
      const item = create("span", "assistant-attachment-chip");
      item.append(
        create("i", "bi bi-paperclip"),
        create("span", null, file.name),
      );
      const remove = create("button", "assistant-attachment-remove", "Remove");
      remove.type = "button";
      remove.setAttribute("aria-label", `Remove ${file.name}`);
      remove.addEventListener("click", () => {
        pendingFiles.splice(index, 1);
        renderPendingFiles();
        setAttachmentStatus();
      });
      item.appendChild(remove);
      attachmentsEl.appendChild(item);
    });
  };

  const currentPageContext = () => {
    const visibleText = (selector, limit) =>
      [...document.querySelectorAll(selector)]
        .map(
          (element) =>
            element.innerText || element.getAttribute("aria-label") || "",
        )
        .map((text) => text.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .slice(0, 12)
        .join(" | ")
        .slice(0, limit);
    return {
      page: location.pathname,
      pageTitle: document.title,
      headings: visibleText("h1, h2, h3", 600),
      controls: visibleText("button, [role=button]", 600),
      language: document.documentElement.lang === "am" ? "am" : "en",
    };
  };

  const readFileAsAttachment = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = String(reader.result || "").split(",", 2)[1];
        if (!base64)
          return reject(
            new Error(
              "Unable to read this file. Please try another supported file.",
            ),
          );
        resolve({
          name: file.name,
          type: fileMimeType(file),
          data: `data:${fileMimeType(file)};base64,${base64}`,
        });
      };
      reader.onerror = () =>
        reject(
          new Error(
            "Unable to read this file. Please try another supported file.",
          ),
        );
      reader.readAsDataURL(file);
    });

  const saveConversationId = (id) => {
    session.conversationId = id || null;
    try {
      if (id) sessionStorage.setItem(CONVERSATION_KEY, id);
      else sessionStorage.removeItem(CONVERSATION_KEY);
    } catch (_) {}
  };

  const deleteConversation = async (id) => {
    if (!id) return;
    try {
      await fetchWithTimeout(
        `${API_BASE_RESOLVED}/assistant/conversation/${encodeURIComponent(id)}`,
        {
          method: "DELETE",
          credentials: "include",
        },
      );
    } catch (_) {}
  };

  fileInput?.addEventListener("change", () => {
    const incoming = [...(fileInput.files || [])];
    fileInput.value = "";
    const totalBytes = [...pendingFiles, ...incoming].reduce(
      (sum, file) => sum + file.size,
      0,
    );
    const unsupported = incoming.find(
      (file) =>
        !ALLOWED_EXTENSIONS.has(file.name.toLowerCase().split(".").pop()),
    );
    if (pendingFiles.length + incoming.length > MAX_FILES) {
      setAttachmentStatus(`Choose up to ${MAX_FILES} files.`);
      return;
    }
    if (totalBytes > MAX_TOTAL_FILE_BYTES) {
      setAttachmentStatus("Attachments must total 10 MB or less.");
      return;
    }
    if (unsupported) {
      setAttachmentStatus(
        "Unable to read this file. Please try another supported file.",
      );
      return;
    }
    pendingFiles.push(...incoming);
    setAttachmentStatus();
    renderPendingFiles();
  });
  attachBtn?.addEventListener("click", () => fileInput?.click());
  stopBtn?.addEventListener("click", () => activeController?.abort());

  const setStatus = (mode) => {
    if (!statusText) return;
    const wrap = statusText.closest(".assistant-status");
    wrap.classList.remove("is-busy", "is-offline");
    if (mode === "busy") {
      wrap.classList.add("is-busy");
      statusText.textContent = "Thinking...";
    } else if (mode === "offline") {
      wrap.classList.add("is-offline");
      statusText.textContent = "Assistant unavailable";
    } else {
      statusText.textContent = authUser
        ? `Signed in as ${authUser.name || "user"}`
        : "Ready to help";
    }
  };

  const scrollToBottom = () => {
    messages.scrollTop = messages.scrollHeight;
  };

  const updateSignInNotice = () => {
    if (!notice) return;
    if (authUser) {
      notice.hidden = false;
      notice.innerHTML = `<i class="bi bi-shield-check me-1" aria-hidden="true"></i>Signed in as <strong>${escapeHtml(authUser.name || "user")}</strong> — live records are limited to data available for your ${escapeHtml(authUser.role || "role")} role.`;
    } else {
      notice.hidden = false;
      notice.innerHTML = `<i class="bi bi-info-circle me-1" aria-hidden="true"></i>Signed-out preview — <a href="/views/login.html">sign in</a> for answers based on records made available to your role.`;
    }
  };

  /* ── Welcome screen ──────────────────────────────────────── */
  const suggestedQuestions = [
    "How do I submit a maintenance request?",
    "My computer is running slowly, what should I check first?",
    authUser
      ? "What is the current status of my tickets?"
      : "How can I track the status of my request?",
    authUser
      ? "Which asset records can Master AI access for my role?"
      : "What ICT services does the platform offer?",
    "Which system actions are restricted to ICT Admins?",
  ].filter(Boolean);

  let welcomeEl = null;

  const showWelcome = () => {
    if (welcomeEl && welcomeEl.isConnected) {
      messages.scrollTop = messages.scrollHeight;
      return welcomeEl;
    }
    const welcome = create("div", "assistant-welcome");
    const avatar = create("span", "assistant-welcome-avatar");
    avatar.innerHTML = '<i class="bi bi-stars" aria-hidden="true"></i>';
    const h1 = create("h1", null, "Smart ICT AI Assistant");
    const p = create(
      "p",
      null,
      "Hello" +
        (authUser ? `, ${authUser.name || ""}` : "") +
        "! I can help with questions about this application, uploaded files, technology, learning, writing, coding, and general knowledge.",
    );
    const userBox = create("div", "assistant-welcome-user");
    userBox.innerHTML =
      '<i class="bi bi-stars me-1" aria-hidden="true"></i>Ask about this system or choose a suggestion below.';
    const chips = create("div", "assistant-suggestions");
    suggestedQuestions.forEach((q) => {
      const chip = create("button", "assistant-suggestion", q);
      chip.type = "button";
      chip.innerHTML = `<i class="bi bi-lightning-charge" aria-hidden="true"></i>${escapeHtml(q)}`;
      chip.addEventListener("click", () => {
        input.value = q;
        input.focus();
        form.requestSubmit();
      });
      chips.appendChild(chip);
    });
    welcome.append(avatar, h1, p, userBox, chips);
    welcomeEl = welcome;
    messages.appendChild(welcome);
    return welcome;
  };

  const addBubble = (type, text) => {
    const row = create("div", `assistant-message is-${type}`);
    const avatar = create("span", "assistant-message-avatar");
    avatar.innerHTML = `<i class="bi ${type === "user" ? "bi-person" : "bi-stars"}" aria-hidden="true"></i>`;
    const bubble = create("div", "assistant-message-bubble");
    const content = create("div", "assistant-message-content");
    if (type === "ai") {
      content.innerHTML = `<p>${renderText(text)}</p>`;
    } else {
      content.textContent = text;
    }
    const time = create("span", "assistant-timestamp", nowLabel());
    bubble.append(content, time);
    row.append(avatar, bubble);
    messages.appendChild(row);
    scrollToBottom();
    return row;
  };

  const makeAiBubble = () => {
    const row = create("div", "assistant-message is-ai");
    const avatar = create("span", "assistant-message-avatar");
    avatar.innerHTML = '<i class="bi bi-stars" aria-hidden="true"></i>';
    const bubble = create("div", "assistant-message-bubble");
    const content = create("div", "assistant-message-content");
    bubble.appendChild(content);
    row.append(avatar, bubble);
    messages.appendChild(row);
    scrollToBottom();
    return {
      row,
      content,
      set(text) {
        content.innerHTML = `<p>${renderText(text)}</p>`;
        scrollToBottom();
      },
      finish() {
        const time = create("span", "assistant-timestamp", nowLabel());
        bubble.appendChild(time);
        scrollToBottom();
      },
    };
  };

  const addActions = (row, text, question) => {
    const actions = create("div", "assistant-actions");
    const copy = create("button", "assistant-action", "");
    copy.innerHTML = '<i class="bi bi-clipboard" aria-hidden="true"></i>Copy';
    const regen = create("button", "assistant-action", "");
    regen.innerHTML =
      '<i class="bi bi-arrow-repeat" aria-hidden="true"></i>Regenerate';
    copy.type = regen.type = "button";
    copy.addEventListener("click", () => copyText(text));
    regen.addEventListener("click", () => submit(question));
    actions.append(copy, regen);
    row.appendChild(actions);
  };

  const addRetryActions = (row, question) => {
    if (row.querySelector(".assistant-actions")) return;
    const actions = create("div", "assistant-actions");
    const retry = create("button", "assistant-action", "");
    retry.innerHTML =
      '<i class="bi bi-arrow-clockwise" aria-hidden="true"></i>Retry';
    retry.type = "button";
    retry.addEventListener("click", () => submit(question));
    actions.appendChild(retry);
    row.appendChild(actions);
  };

  const copyText = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch (_) {
        /* no-op */
      }
      ta.remove();
    }
  };

  /* ── Reset / new chat ────────────────────────────────────── */
  const reset = () => {
    const previousConversationId = session.conversationId;
    activeController?.abort();
    deleteConversation(previousConversationId);
    session.conversation = [];
    saveConversationId(null);
    pendingFiles = [];
    renderPendingFiles();
    setAttachmentStatus();
    messages.replaceChildren();
    welcomeEl = null;
    showWelcome();
    setStatus("idle");
    input.value = "";
  };

  clearBtn.addEventListener("click", reset);
  newChatBtn.addEventListener("click", reset);

  async function loadExistingConversation() {
    try {
      session.conversationId = sessionStorage.getItem(CONVERSATION_KEY);
    } catch (_) {
      session.conversationId = null;
    }
    if (!session.conversationId) return false;
    try {
      const response = await fetchWithTimeout(
        `${API_BASE_RESOLVED}/assistant/conversation/${encodeURIComponent(session.conversationId)}`,
        { credentials: "include" },
      );
      if (!response.ok) {
        saveConversationId(null);
        return false;
      }
      const data = await response.json();
      const history = Array.isArray(data.messages) ? data.messages : [];
      if (!history.length) return false;
      session.conversation = history;
      messages.replaceChildren();
      welcomeEl = null;
      for (let index = 0; index < history.length; index += 1) {
        const item = history[index];
        if (item.role === "assistant") {
          const previousQuestion =
            history[index - 1]?.role === "user"
              ? history[index - 1].content
              : "";
          const row = addBubble("ai", item.content);
          if (previousQuestion) addActions(row, item.content, previousQuestion);
        } else {
          addBubble("user", item.content);
        }
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  /* ── Composer behaviour ──────────────────────────────────── */
  const autoResize = () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 160) + "px";
  };
  input.addEventListener("input", autoResize);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  /* ── Submit ──────────────────────────────────────────────── */
  async function submit(message) {
    if (!message || session.inFlight) return;
    const selectedFiles = pendingFiles.slice();
    session.inFlight = true;
    sendBtn.disabled = true;
    input.disabled = true;
    attachBtn.disabled = true;
    fileInput.disabled = true;
    stopBtn.hidden = false;
    setStatus("busy");

    const userText = selectedFiles.length
      ? `${message}\n\nAttached: ${selectedFiles.map((file) => file.name).join(", ")}`
      : message;
    addBubble("user", userText);
    if (welcomeEl && welcomeEl.isConnected) welcomeEl.remove();
    session.conversation.push({ role: "user", content: message });
    input.value = "";
    autoResize();

    const thinking = create("div", "assistant-message is-ai is-thinking");
    const avatar = create("span", "assistant-message-avatar");
    avatar.innerHTML = '<i class="bi bi-stars" aria-hidden="true"></i>';
    const bubble = create("div", "assistant-message-bubble");
    const content = create("div", "assistant-message-content");
    content.textContent = selectedFiles.length
      ? "Analyzing your file..."
      : "AI is thinking...";
    bubble.appendChild(content);
    thinking.append(avatar, bubble);
    messages.appendChild(thinking);
    scrollToBottom();

    const controller = new AbortController();
    activeController = controller;
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 150000);
    let streamed = null;
    try {
      if (selectedFiles.length) setAttachmentStatus("Analyzing your file...");
      const attachmentPayloads = await Promise.all(
        selectedFiles.map(readFileAsAttachment),
      );
      const response = await fetch(`${API_BASE_RESOLVED}/ai/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          message,
          conversationId: session.conversationId,
          conversation: session.conversation.slice(0, -1),
          attachments: attachmentPayloads,
          stream: true,
          context: currentPageContext(),
        }),
        signal: controller.signal,
      });

      const contentType = response.headers.get("content-type") || "";
      const isStream = response.ok && contentType.includes("text/event-stream");
      if (isStream) {
        if (!response.body)
          throw new Error("The AI service returned no stream data.");
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
            } catch (_) {
              continue;
            }
            if (event && event.content) {
              answer += event.content;
              streamed.set(answer);
            }
            if (event && event.error) throw new Error(event.error);
            if (event && event.done === true) {
              saveConversationId(
                event.conversationId || session.conversationId,
              );
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

        if (!answer.trim() && !receivedDone) {
          throw new Error(
            "The AI Assistant returned an empty response. Please try again.",
          );
        }
        answer = answer.trim();
        streamed.set(answer);
        streamed.finish();
        session.conversation.push({ role: "assistant", content: answer });
        addActions(streamed.row, answer, message);
        pendingFiles = pendingFiles.filter(
          (file) => !selectedFiles.includes(file),
        );
        renderPendingFiles();
        setAttachmentStatus();
      } else {
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          const msg = result && result.message;
          throw new Error(
            msg || "AI Assistant request failed. Please try again.",
          );
        }
        const answer = result?.data?.message || result?.message;
        if (typeof answer !== "string" || !answer.trim()) {
          throw new Error(
            "The AI Assistant returned an empty response. Please try again.",
          );
        }
        thinking.remove();
        saveConversationId(result.conversationId || session.conversationId);
        session.conversation.push({ role: "assistant", content: answer });
        const aiRow = addBubble("ai", answer);
        addActions(aiRow, answer, message);
        pendingFiles = pendingFiles.filter(
          (file) => !selectedFiles.includes(file),
        );
        renderPendingFiles();
        setAttachmentStatus();
      }
    } catch (error) {
      thinking.remove();
      session.conversation.pop();
      const msg = chatRequestError(error, timedOut);
      if (selectedFiles.length) setAttachmentStatus(msg);
      if (streamed) {
        streamed.row.classList.add("is-error");
        streamed.set(msg);
        streamed.finish();
        addRetryActions(streamed.row, message);
        setStatus("offline");
      } else {
        const row = addBubble("ai", msg);
        row.classList.add("is-error");
        addRetryActions(row, message);
        setStatus("offline");
      }
    } finally {
      clearTimeout(timeoutId);
      activeController = null;
      session.inFlight = false;
      sendBtn.disabled = false;
      input.disabled = false;
      attachBtn.disabled = false;
      fileInput.disabled = false;
      stopBtn.hidden = true;
      if (document.querySelector(".assistant-message.is-error")) return;
      setStatus("idle");
      setTimeout(() => input.focus(), 50);
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    submit(input.value.trim());
  });

  /* ── Boot ────────────────────────────────────────────────── */
  async function initialize() {
    try {
      const response = await fetchWithTimeout(`${API_BASE_RESOLVED}/auth/me`, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (response.ok) {
        const data = await response.json().catch(() => ({}));
        authUser = data.user || null;
      }
    } catch (_) {}
    updateSignInNotice();
    setStatus("idle");
    const restored = await loadExistingConversation();
    if (!restored) showWelcome();
    input.focus();
  }
  showWelcome();
  initialize();
})();
