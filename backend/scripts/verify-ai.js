/**
 * Verify the Gemini AI Studio Free Tier service.
 *
 * Add --ask="..." to make one real inference after checking key reachability
 * and model availability. API credentials are never printed.
 */
require("dotenv").config({
  path: require("path").join(__dirname, "..", ".env"),
});

const { geminiService } = require("../services/geminiService");

async function main() {
  console.log("\n  ── Gemini Master AI verification ─────────────────");
  console.log(`  Model   : ${geminiService.model}`);
  console.log(`  Timeout : ${geminiService.timeoutMs} ms`);

  if (!geminiService.isEnabled()) {
    console.error("  ✖  AI_SUPPORT_ENABLED=false — AI support is disabled.");
    process.exitCode = 1;
    return;
  }

  const ping = await geminiService.ping();
  if (!ping.ok) {
    console.error(
      `  ✖  Gemini request failed (HTTP ${ping.status || "no response"}). Check the server-side GEMINI_API_KEY.`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(`  ✔  Gemini API reachable (${ping.latencyMs} ms).`);

  const models = await geminiService.listModels();
  if (!geminiService.isModelAvailable(geminiService.model, models)) {
    console.error(
      `  ✖  ${geminiService.model} is not available for generateContent with this key.`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(`  ✔  ${geminiService.model} is available for text generation.`);

  const askArg = process.argv.find((arg) => arg.startsWith("--ask="));
  if (askArg) {
    try {
      const { content } = await geminiService.chat({
        system: "You are Master AI. Answer clearly and briefly in plain text.",
        messages: [{ role: "user", content: askArg.slice("--ask=".length) }],
      });
      console.log(`  ✔  Real Gemini inference succeeded (${content.length} characters).`);
      console.log(`\n  ${content.slice(0, 500)}\n`);
    } catch (error) {
      console.error(
        `  ✖  Gemini inference failed (code=${error?.code || "unknown"}).`,
      );
      process.exitCode = 1;
    }
  } else {
    console.log('\n  Run with --ask="What is ICT?" to test real inference.\n');
  }
}

main().catch((error) => {
  console.error(
    "  ✖  Gemini verification failed:",
    error?.name || "Unexpected error",
  );
  process.exitCode = 1;
});
