import { loadConfig } from './config';
import { EventBus } from './events';
import { runAutonomous } from './run';
import { startSocketServer } from './server/socket';
import { formatTokens } from './telemetry/tokens';

/**
 * Entry point daemon Brain.
 *
 *   npm run dev                          → hanya realtime server
 *   npm run dev -- "prompt Founder"      → server + 1 run otonom penuh
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const bus = new EventBus();
  const server = await startSocketServer(config, bus);

  console.log('┌──────────────────────────────────────────────────────────────┐');
  console.log('│  AutoOffice3D · THE BRAIN daemon v1.4                        │');
  console.log('└──────────────────────────────────────────────────────────────┘');
  console.log(`  socket       ${server.url}`);
  console.log(`  health       http://localhost:${server.port}/health`);
  console.log(`  drivers      llm=${config.llmDriver} memory=${config.memoryDriver} sandbox=${config.sandboxDriver}`);
  console.log(`  guardrails   breaker=${config.maxIterations}x · token budget=${formatTokens(config.tokenBudget)}`);

  const prompt = process.argv[2] ?? process.env.FOUNDER_PROMPT;
  if (prompt) {
    console.log(`\n  founder      "${prompt}"\n`);
    const started = Date.now();
    const { state, tokensUsed } = await runAutonomous(prompt, { config, emit: bus });
    console.log(
      `\n  ✓ run ${state.runId} → ${state.stage} · ${state.iteration}/${state.maxIterations} cycles · ${formatTokens(tokensUsed)} tokens · ${Date.now() - started}ms`,
    );
    console.log(`    live: https://${state.liveUrl}`);
  } else {
    console.log('\n  waiting for founder:directive …');
  }

  const shutdown = async () => {
    console.log('\n  shutting down brain …');
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err: unknown) => {
  console.error('[brain] failed to start:', err);
  process.exitCode = 1;
});
