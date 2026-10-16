import { loadConfig } from './config';
import { EventBus } from './events';
import { runAutonomous } from './run';
import { formatTokens } from './telemetry/tokens';
import { timestampMs } from './types';

/**
 * CLI demo tanpa server: memutar satu run otonom lengkap dan mencetak
 * setiap event telemetry persis seperti yang dikirim via Socket.io.
 *
 *   npm run simulate -- "Micro-SaaS invoice generator with Stripe integration"
 */
async function main(): Promise<void> {
  const prompt = process.argv[2] ?? 'Micro-SaaS invoice generator with Stripe integration';
  const config = loadConfig();

  console.log('┌──────────────────────────────────────────────────────────────┐');
  console.log('│  AutoOffice3D · THE BRAIN — autonomous run (simulate)        │');
  console.log('└──────────────────────────────────────────────────────────────┘');
  console.log(
    `  drivers      llm=${config.llmDriver} memory=${config.memoryDriver} sandbox=${config.sandboxDriver}`,
  );
  console.log(
    `  guardrails   maxIterations=${config.maxIterations} tokenBudget=${config.tokenBudget.toLocaleString()}`,
  );
  console.log(`  founder      "${prompt}"\n`);

  const bus = new EventBus();
  bus.onAgent((p) => {
    const cycle = p.iterationCycle
      ? ` · cycle ${p.iterationCycle.current}/${p.iterationCycle.max}`
      : '';
    console.log(
      `  ${p.timestamp} [${p.agentId.padEnd(14)}] ${p.currentAction.padEnd(11)} @ ${p.targetZone.padEnd(17)} ${p.logMessage}${cycle}`,
    );
  });
  bus.onMilestone((p) => {
    console.log(
      `\n  ✦ MILESTONE:first_sale  $${p.amount.toFixed(2)} ${p.currency} · ${p.customer.city}, ${p.customer.country} · ${p.customer.maskedEmail}`,
    );
  });

  const started = Date.now();
  const { state, tokensUsed, tokenBreakdown } = await runAutonomous(prompt, { config, emit: bus });
  const elapsed = Date.now() - started;

  console.log('\n──────────────────────────────── RUN SUMMARY ────────────────────────────────');
  console.log(`  runId        ${state.runId}`);
  console.log(
    `  stage        ${state.stage}${state.fallbackTriggered ? '  (circuit breaker → safe-build)' : ''}${state.graphLocked ? '  [GRAPH LOCKED]' : ''}`,
  );
  console.log(`  iterations   ${state.iteration}/${state.maxIterations} · ${state.lastQaSummary}`);
  console.log(`  artifacts    ${Object.keys(state.artifacts).join(', ')}`);
  console.log(
    `  diffs        ${Object.entries(state.diffs)
      .filter(([, d]) => d.status !== 'unchanged')
      .map(([p, d]) => `${p} +${d.added}/-${d.removed}`)
      .join(' · ')}`,
  );
  console.log(`  repo         ${state.repoUrl}`);
  console.log(
    `  live url     https://${state.liveUrl}  (health ${state.healthOk ? '200 OK' : 'FAILED'})`,
  );
  console.log(`  hasCustomers ${state.hasCustomers}`);
  console.log(`  tokens       ${formatTokens(tokensUsed)} / ${formatTokens(config.tokenBudget)}`);
  const divisions = Object.entries(tokenBreakdown);
  console.log(
    `  per division ${divisions.length ? divisions.map(([d, t]) => `${d}=${formatTokens(t)}`).join(' · ') : '(none)'}`,
  );
  console.log(
    `  events       ${bus.history.length} agent telemetry · ${bus.milestones.length} milestone`,
  );
  console.log(`  wall clock   ${elapsed}ms (${timestampMs()})`);
  console.log('──────────────────────────────────────────────────────────────────────────────');

  const failed = state.stage === 'failed';
  process.exitCode = failed ? 1 : 0;
}

main().catch((err: unknown) => {
  console.error('\n[brain] run aborted:', err);
  process.exitCode = 1;
});
