import { BriefingService } from './briefing';
import { loadConfig } from './config';
import { createCheckpointer, openOfficeDb, RunStore } from './durability/store';
import { ensureDataDir } from './durability/paths';
import { EventBus } from './events';
import { StripeSentinel } from './integrations';
import { createLLM } from './llm';
import { createMemory } from './memory';
import { runAutonomous, seedMemory } from './run';
import { startSocketServer } from './server/socket';
import { formatTokens } from './telemetry/tokens';
import { BRAIN_VERSION } from './version';

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

  // Durability (PRD v3.0 §2.1): seluruh state di satu folder DATA_DIR —
  // memory LanceDB + office.db (checkpoint, run history, event log).
  const paths = ensureDataDir(config.dataDir);
  const db = openOfficeDb(paths.dbPath);
  const store = new RunStore(db);
  const checkpointer = createCheckpointer(paths.dbPath);
  store.attach(bus);
  const interrupted = store.recoverInterrupted();

  // Vector memory dibuat sekali, di-seed, lalu dibagikan ke socket server
  // (untuk jumlah vektor di snapshot) dan tiap run otonom.
  const memory = createMemory(config);
  await seedMemory(memory);

  // Fase 8 — Briefing Room: percakapan Founder↔PM (LLM task `briefing`),
  // durable di namespace `briefing`, GO → compile brief → founder:directive.
  const briefing = new BriefingService({ memory, llm: createLLM(config) });

  const server = await startSocketServer(config, bus, {
    sentinel,
    memory,
    store,
    checkpointer,
    briefing,
  });

  console.log('┌──────────────────────────────────────────────────────────────┐');
  console.log(`│  AutoOffice3D · THE BRAIN daemon v${BRAIN_VERSION}                        │`);
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
  console.log(`  data dir     ${paths.root} (office.db + lancedb/)`);
  if (interrupted.length > 0) {
    console.log(
      `  recovery     ${interrupted.length} run terputus ditandai interrupted → ${interrupted.join(', ')}`,
    );
  }

  const prompt = process.argv[2] ?? process.env.FOUNDER_PROMPT;
  if (prompt) {
    console.log(`\n  founder      "${prompt}"\n`);
    const started = Date.now();
    const { state, tokensUsed } = await runAutonomous(prompt, {
      config,
      emit: bus,
      sentinel,
      memory,
      store,
      checkpointer,
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
    db.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err: unknown) => {
  console.error('[brain] failed to start:', err);
  process.exitCode = 1;
});
