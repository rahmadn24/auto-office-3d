'use client';

import { useEffect, type ReactNode } from 'react';

import { connectBrain, disconnectBrain } from '@/lib/brainSocket';

/**
 * Mount koneksi Socket.io Brain ↔ Theater (sekali per app). Menjalankan
 * auto-reconnect + validasi Zod di lib/brainSocket.ts. Tidak merender apa pun.
 */
export function BrainBridge(): ReactNode {
  useEffect(() => {
    const socket = connectBrain();
    return () => {
      socket.disconnect();
      disconnectBrain();
    };
  }, []);

  return null;
}
