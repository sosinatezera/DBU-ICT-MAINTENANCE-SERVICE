/**
 * scripts/verify-ollama.js — Master AI (local Ollama) verification tool.
 * Smart ICT Maintenance Management System
 *
 * Checks (in order):
 *   1. AI_SUPPORT_ENABLED is on.
 *   2. Ollama is reachable at OLLAMA_BASE_URL (GET /api/tags within the
 *      configured ping timeout — no inference is triggered).
 *   3. Which models are installed, and whether the configured OLLAMA_MODEL
 *      is present.
 *   4. (Optional) one real non-stream inference to confirm the pipeline:
 *      node scripts/verify-ollama.js --ask="What is ICT?"
 *
 * Run from backend/:   npm run verify:ollama
 *
 * Exit codes: 0 = ok/skipped, 1 = a check failed.
 */
require("dotenv").config({
  path: require("path").join(__dirname, "..", ".env"),
});

const { ollamaService } = require("../services/ollamaService");

const checks = { pass: 0, fail: 0 };
const ok = (msg) => {
  checks.pass++;
  console.log(`  ✔  ${msg}`);
};
const bad = (msg) => {
  checks.fail++;
  console.log(`  ✖  ${msg}`);
};

async function main() {
  console.log("\n  ── Master AI (Ollama) verification ─────────────────");
  console.log(`  Base URL : ${ollamaService.baseUrl}`);
  console.log(`  Model    : ${ollamaService.model}`);
  console.log(`  Timeout  : ${ollamaService.timeoutMs} ms`);
  console.log("  ────────────────────────────────────────────────────");

  if (!ollamaService.isEnabled()) {
    bad("AI_SUPPORT_ENABLED=false — the AI Assistant is disabled.");
    console.log("\n  Set AI_SUPPORT_ENABLED=true in backend/.env and re-run.\n");
    process.exit(1);
  }
  ok("AI support is enabled.");

  const ping = await ollamaService.ping();
  if (!ping.ok) {
    bad(
      `Ollama is NOT reachable at ${ollamaService.baseUrl} (status=${ping.status || "none"}).`,
    );
    console.log("\n  1. Install Ollama from https://ollama.com");
    console.log(
      '  2. Start it: `ollama serve` (or the desktop app)',
    );
    console.log("  3. Pull the model: `ollama pull llama3.2`\n");
    process.exit(1);
  }
  ok(`Ollama is reachable (${ping.latencyMs} ms).`);

  const installedModels = await ollamaService.installedModels();
  ok(
    `Found ${installedModels.length} installed model(s)${installedModels.length ? `: ${installedModels.join(", ")}` : ""}.`,
  );

  if (ollamaService.isModelInstalled(ollamaService.model, installedModels)) {
    ok(`Configured model "${ollamaService.model}" is installed.`);
  } else {
    bad(`Configured model "${ollamaService.model}" is NOT installed.`);
    console.log(`\n  Install it with:  ollama pull ${ollamaService.model}\n`);
  }

  const askArg = process.argv.find((a) => a.startsWith("--ask="));
  if (askArg) {
    const question = askArg.slice("--ask=".length);
    console.log(`\n  Asking Ollama: "${question}"`);
    try {
      const { content } = await ollamaService.chat({
        system:
          "You are Master AI. Answer clearly and briefly in plain text.",
        messages: [{ role: "user", content: question }],
      });
      ok(`Inference OK (${content.length} characters).`);
      console.log(`\n  ${content.slice(0, 500)}\n`);
    } catch (error) {
      bad(
        `Inference failed (code=${error && error.code ? error.code : "unknown"}): ${error && error.message ? error.message : error}`,
      );
    }
  } else {
    console.log("\n  Tip: run one real inference with:");
    console.log('  npm run verify:ollama -- --ask="Explain what ICT is."\n');
  }

  console.log(`  ── ${checks.pass} passed, ${checks.fail} failed ──\n`);
  process.exit(checks.fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("  ✖  Unexpected error:", err && err.message ? err.message : err);
  process.exit(1);
});