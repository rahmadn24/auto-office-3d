import { BriefingService } from './briefing';
import { loadConfig } from './config';
import { LeadsStore } from './cs/leads';
import { createCheckpointer, openOfficeDb, RunStore } from './durability/store';
import { ensureDataDir } from './durability/paths';
import { EventBus } from './events';
import { createEmail } from './integrations';
import { breakerMessage, createNotifier, deployMessage, saleMessage } from './integrations/notify';
import { logger } from './logger';
import { createLLM } from './llm';
import { formatCostUsd } from './llm/pricing';
import { createMemory } from './memory';
import { createPayment } from './payments';
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
  const payment = createPayment(config);

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

  const llm = createLLM(config);
  const email = createEmail(config);

  // Fase 12 — notifikasi founder: milestone sale + deploy siap sampai di
  // Telegram/Discord walau kantor tidak ditunggui (driver stub = catat lokal).
  const notify = createNotifier(config);
  bus.onMilestone((payload) => {
    void notify.send(saleMessage(payload));
  });
  bus.onDeploy((payload) => {
    // Hanya status final yang penting; provisioning→building→deploying tidak
    // perlu notifikasi (mengurangi noise saat soak).
    if (payload.status === 'ready' || payload.status === 'degraded') {
      void notify.send(deployMessage(payload));
    }
  });

  // Fase 8 — Briefing Room: percakapan Founder↔PM (LLM task `briefing`),
  // durable di namespace `briefing`, GO → compile brief → founder:directive.
  const briefing = new BriefingService({ memory, llm });

  // Fase 11 — CS Agent: leads store bersama (mini-CRM) + omnichannel inbox.
  // Run otonom ikut menerima leads store → node Marketing menulis handoff lead.
  const leads = new LeadsStore(db);

  const server = await startSocketServer(config, bus, {
    payment,
    memory,
    store,
    checkpointer,
    briefing,
    leads,
    llm,
    email,
    notify,
  });

  // Follow-up engine (PRD §3.5): sapu berkala lead yang jatuh tempo → CS kirim
  // tindak lanjut via channel asal. 0 = matikan scheduler (mis. e2e deterministik).
  let followupTimer: NodeJS.Timeout | null = null;
  if (server.cs && config.csFollowupMs > 0) {
    followupTimer = setInterval(() => {
      void server.cs?.sweep().then((result) => {
        if (result.sent > 0 || result.lost > 0) {
          logger.info(
            {
              checked: result.checked,
              sent: result.sent,
              templates: result.templates,
              lost: result.lost,
            },
            'cs follow-up sweep',
          );
        }
      });
    }, config.csFollowupMs);
    followupTimer.unref();
  }

  console.log('┌──────────────────────────────────────────────────────────────┐');
  console.log(`│  AutoOffice3D · THE BRAIN daemon v${BRAIN_VERSION}                        │`);
  console.log('└──────────────────────────────────────────────────────────────┘');
  console.log(`  socket       ${server.url}`);
  console.log(`  health       http://localhost:${server.port}/health`);
  console.log(`  webhook      http://localhost:${server.port}/webhook/${payment.id}`);
  if (payment.id === 'stub') {
    console.log(
      `  demo pay     http://localhost:${server.port}/demo/checkout?order_id=… (driver stub)`,
    );
  }
  console.log(
    `  drivers      llm=${config.llmDriver} memory=${config.memoryDriver} sandbox=${config.sandboxDriver} deploy=${config.deployDriver} social=${config.socialDriver}`,
  );
  console.log(
    `  cs agent     whatsapp=${config.whatsappDriver} · follow-up tiap ${Math.round(config.csFollowupMs / 1000)}s · widget ${config.csWidgetUrl}/demo/widget`,
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
    const { state, tokensUsed, costUsd } = await runAutonomous(prompt, {
      config,
      emit: bus,
      payment,
      memory,
      store,
      checkpointer,
      leads,
    });
    console.log(
      `\n  ✓ run ${state.runId} → ${state.stage} · ${state.iteration}/${state.maxIterations} cycles · ${formatTokens(tokensUsed)} tokens · ~${formatCostUsd(costUsd)} · ${Date.now() - started}ms`,
    );
    console.log(`    live: https://${state.liveUrl}`);
    if (state.fallbackTriggered) {
      void notify.send(
        breakerMessage(state.runId, `safe-build aktif setelah ${state.maxIterations}x QA`),
      );
    }
  } else {
    console.log('\n  waiting for founder:directive …');
  }

  const shutdown = async () => {
    console.log('\n  shutting down brain …');
    if (followupTimer) clearInterval(followupTimer);
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
