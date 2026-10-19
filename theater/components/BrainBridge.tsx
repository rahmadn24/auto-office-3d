'use client';

import { useEffect, type ReactNode } from 'react';

import { connectBrain, disconnectBrain } from '@/lib/brainSocket';

/**
 * Mount koneksi Socket.io Brain ↔ Theater (sekali per app). Menjalankan
 * auto-reconnect + validasi Zod di lib/brainSocket.ts. Tidak merender apa pun.
 */
export function BrainBridge(): ReactNode {
  useEffect(() => {
    connectBrain();
    // Dipasang sekali di root layout — jangan putuskan socket saat pindah tab.
    return () => disconnectBrain();
  }, []);

  return null;
}
