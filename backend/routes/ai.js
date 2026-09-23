const express = require("express");
const OpenAI = require("openai");
const { optionalAuthenticate } = require("../middleware/auth");
const { rateLimit } = require("../middleware/rateLimiter");

const router = express.Router();
const MAX_MESSAGE_LENGTH = 4000;
const MAX_HISTORY_ITEMS = 12;
const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
const aiRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

const SYSTEM_PROMPT = `You are a helpful general-purpose AI assistant for the Smart ICT Maintenance Management System.

You can answer general questions, explain concepts, help write messages, summarize information, provide troubleshooting guidance, and support ICT-related tasks. You are especially helpful with computers, printers, networks, software, hardware, maintenance issues, and system usage, but you are not limited to ICT topics.

Guidelines:
1. Understand the user's intent and respond naturally to ordinary conversations as well as technical questions.
2. Ask one short clarification question when needed.
3. Give clear, practical, and concise answers.
4. Prefer safe and reversible troubleshooting steps when helping with technical issues.
5. For real maintenance or hardware failures, suggest the user submit an ICT maintenance request through the system when appropriate.
6. Never claim a repair or system action was completed.
7. Never invent request IDs, asset IDs, technician names, statuses, or database information.
8. Be conversational, professional, and helpful.
9. For burning smells, smoke, exposed electrical parts, liquid damage, damaged power supplies, or dangerous overheating, tell the user to stop using the equipment and seek qualified technical assistance.
10. For cybersecurity, provide defensive guidance only. Do not help with unauthorized access, credential theft, malware, evasion, or attacks.
11. Never claim to have inspected a device, changed settings, contacted someone, or created a service request unless the user explicitly confirms it.

You are advisory only and cannot create, modify, assign, close, or resolve service requests directly.`;

router.post("/chat", aiRateLimit, optionalAuthenticate, async (req, res) => {
  const message =
    typeof req.body?.message === "string" ? req.body.message.trim() : "";
  if (!message)
    return res
      .status(422)
      .json({ success: false, message: "Please enter a question or message." });
  if (message.length > MAX_MESSAGE_LENGTH) {
    return res.status(422).json({
      success: false,
      message: `Please keep your message under ${MAX_MESSAGE_LENGTH} characters.`,
    });
  }

  const history = Array.isArray(req.body?.history)
    ? req.body.history
        .filter(
          (item) =>
            item &&
            (item.role === "user" || item.role === "assistant") &&
            typeof item.content === "string" &&
            item.content.trim(),
        )
        .slice(-MAX_HISTORY_ITEMS)
        .map((item) => ({
          role: item.role,
          content: item.content.trim().slice(0, MAX_MESSAGE_LENGTH),
        }))
    : [];

  const aiEnabled = process.env.AI_SUPPORT_ENABLED !== "false";
  const hasOpenAiKey = Boolean(
    process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim(),
  );

  if (!aiEnabled) {
    console.warn("[AI Support] AI_SUPPORT_ENABLED=false. AI chat is disabled.");
    return res.status(503).json({
      success: false,
      message:
        "The AI assistant is currently disabled. Please try again later.",
    });
  }

  if (!hasOpenAiKey) {
    console.warn(
      "[AI Support] OPENAI_API_KEY is missing or empty for this environment. " +
        `OPENAI_MODEL="${model}". ` +
        "Set OPENAI_API_KEY in the deployment's environment variables to enable AI chat.",
    );
    return res.status(503).json({
      success: false,
      message:
        "The AI assistant is not configured on this server yet. Please try again later.",
    });
  }

  try {
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 15000,
      maxRetries: 1,
    });
    const context = {
      role: req.user?.role || "Visitor",
      page:
        typeof req.body?.context?.page === "string"
          ? req.body.context.page.slice(0, 120)
          : "Unknown",
    };
    /* Send structured conversation turns so the user's LATEST message is always
       the final, explicit input item — the model must answer the current question,
       while earlier turns are passed as clearly-typed history (user/assistant). */
    const inputItems = history.map((item) => ({
      role: item.role === "assistant" ? "assistant" : "user",
      content: item.content,
    }));
    inputItems.push({ role: "user", content: message });

    const response = await client.responses.create({
      model,
      instructions: `${SYSTEM_PROMPT}

User context: ${JSON.stringify(context)}
Always answer the user's LATEST question above the conversation history. If the latest question refers to an earlier topic, address that topic but respond to the current question — never repeat an earlier answer.`,
      input: inputItems,
      max_output_tokens: 700,
      temperature: 0.7,
    });
    const answer = response.output_text?.trim();
    if (!answer) throw new Error("Empty AI response");
    return res.json({ success: true, data: { message: answer } });
  } catch (error) {
    const status = error?.status || "n/a";
    const code = error?.code || "unknown";
    const type = error?.type || "unknown";
    console.error(
      `[AI Support] OpenAI request failed (status=${status}, code=${code}, type=${type}):`,
      error?.message || "unknown error",
    );
    return res.status(502).json({
      success: false,
      message:
        "The AI assistant is unavailable right now. Please try again later.",
    });
  }
});

module.exports = router;
