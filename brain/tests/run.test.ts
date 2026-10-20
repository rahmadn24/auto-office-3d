import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config';
import { EventBus } from '../src/events';
import { guessProjectName, runAutonomous } from '../src/run';
import { AGENT_IDS } from '../src/types';

describe('guessProjectName — nama produk untuk PRD & URL deploy', () => {
  it('membuang kata depan Bahasa Indonesia, bukan memotong di "untuk"', () => {
    expect(
      guessProjectName(
        'Aplikasi kasir + pembukuan untuk UMKM. PWA offline-first, stack Next.js + Supabase.',
      ),
    ).toBe('Aplikasi Kasir Pembukuan UMKM');
  });

  it('membuang kata kerja perintah & stopword bahasa Inggris', () => {
    expect(guessProjectName('build a SaaS invoicing app')).toBe('SaaS Invoicing App');
    expect(guessProjectName('Micro-SaaS invoice generator with Stripe integration')).toBe(
      'Micro-SaaS Invoice Generator',
    );
  });

  it('membuang ringkasan meta Briefing Room, bukan memakai "Brief Diskusi Founder PM"', () => {
    expect(
      guessProjectName(
        'Brief dari diskusi Founder↔PM: bangun aplikasi kasir + pembukuan untuk UMKM, fitur lengkap',
      ),
    ).toBe('Aplikasi Kasir Pembukuan UMKM');
    expect(guessProjectName('Brief Diskusi Founder↔PM — invoice generator untuk freelancer')).toBe(
      'Invoice Generator Freelancer',
    );
  });

  it('mengabaikan blok brief tambahan agar nama diambil dari kalimat founder', () => {
    expect(
      guessProjectName(
        'Bangun dashboard analytics untuk tim\n\n[Brief Ringkas — hasil Briefing Room]\n- Audience: tim ops',
      ),
    ).toBe('Dashboard Analytics Tim');
  });
});

describe('runAutonomous — status penutup setelah run selesai', () => {
  it('memulangkan semua agen ke idle dan menandai RUN COMPLETE', async () => {
    const events = new EventBus();
    const result = await runAutonomous('Micro-SaaS invoice generator with Stripe integration', {
      config: loadConfig({ MEMORY_DRIVER: 'memory' }),
      emit: events,
    });

    expect(result.state.stage).toBe('done');
    for (const agentId of AGENT_IDS) {
      const last = [...events.history].reverse().find((p) => p.agentId === agentId);
      expect(last, `status akhir ${agentId}`).toBeTruthy();
      expect(last?.currentAction).toBe('idle');
    }
    expect(events.history.some((p) => p.logMessage.includes('RUN COMPLETE'))).toBe(true);
  }, 60_000);
});
