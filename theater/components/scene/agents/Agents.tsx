'use client';

import type { ReactNode } from 'react';

import { AGENT_ROSTER, useOffice } from '@/store/officeStore';

import { BoxMan } from './BoxMan';

/** Roster 6 agen + wiring arrival (WALKING → state pending di store). */
export function Agents(): ReactNode {
  const arrive = useOffice((s) => s.arrive);

  return (
    <group>
      {AGENT_ROSTER.map((entry, index) => (
        <BoxMan
          key={entry.id}
          entry={entry}
          offsetIndex={index}
          onArrive={(): void => arrive(entry.id)}
        />
      ))}
    </group>
  );
}
