import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { BrainBridge } from '@/components/BrainBridge';

import './globals.css';

export const metadata: Metadata = {
  title: 'AutoOffice3D · The Theater',
  description:
    'Kantor 3D isometrik tempat Brain otonom (PRD → kode → QA → deploy → sale) berjalan real-time.',
};

export const viewport: Viewport = {
  themeColor: '#051424',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-surface font-body text-on-surface antialiased">
        {/* Koneksi Brain dipasang sekali di root layout — bertahan lintas tab. */}
        <BrainBridge />
        {children}
      </body>
    </html>
  );
}
