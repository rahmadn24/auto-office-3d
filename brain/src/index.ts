import { loadConfig } from './config';
import { EventBus } from './events';
import { StripeSentinel } from './integrations';
import { createMemory } from './memory';
import { runAutonomous, seedMemory } from './run';
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
  const sentinel = new StripeSentinel(config.stripeWebhookSecret);
  // Vector memory dibuat sekali, di-seed, lalu dibagikan ke socket server
  // (untuk jumlah vektor di snapshot) dan tiap run otonom.
  const memory = createMemory(config);
  await seedMemory(memory);
  const server = await startSocketServer(config, bus, { sentinel, memory });

  console.log('┌──────────────────────────────────────────────────────────────┐');
  console.log('│  AutoOffice3D · THE BRAIN daemon v1.6                        │');
  console.log('└──────────────────────────────────────────────────────────────┘');
  console.log(`  socket       ${server.url}`);
  console.log(`  health       http://localhost:${server.port}/health`);
  console.log(`  webhook      http://localhost:${server.port}/webhook/stripe`);
  console.log(
    `  drivers      llm=${config.llmDriver} memory=${config.memoryDriver} sandbox=${config.sandboxDriver} deploy=${config.deployDriver} social=${config.socialDriver}`,
  );
  console.log(
    `  guardrails   breaker=${config.maxIterations}x · token budget=${formatTokens(config.tokenBudget)}`,
  );

  const prompt = process.argv[2] ?? process.env.FOUNDER_PROMPT;
  if (prompt) {
    console.log(`\n  founder      "${prompt}"\n`);
    const started = Date.now();
    const { state, tokensUsed } = await runAutonomous(prompt, {
      config,
      emit: bus,
      sentinel,
      memory,
    });
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
