import type { AgentStatusPayload, FirstSalePayload } from './types';
import {
  AGENT_DIVISION,
  AGENT_HOME_ZONE,
  ZONE_COORDINATES,
  timestampMs,
  type AgentId,
  type CurrentAction,
  type TargetZone,
  type Telemetry,
} from './types';

export interface EmitAgentInput {
  runId: string;
  agentId: AgentId;
  action: CurrentAction;
  zone?: TargetZone;
  logMessage: string;
  iterationCycle?: { current: number; max: number };
  telemetry: Telemetry;
}

export interface Emitter {
  agent(payload: AgentStatusPayload): void;
  milestone(payload: FirstSalePayload): void;
}

/** Event bus in-process — Socket.io (dan test) tinggal berlangganan di sini. */
export class EventBus implements Emitter {
  private listeners: Array<(p: AgentStatusPayload) => void> = [];
  private milestoneListeners: Array<(p: FirstSalePayload) => void> = [];
  readonly history: AgentStatusPayload[] = [];
  readonly milestones: FirstSalePayload[] = [];

  onAgent(fn: (p: AgentStatusPayload) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  onMilestone(fn: (p: FirstSalePayload) => void): () => void {
    this.milestoneListeners.push(fn);
    return () => {
      this.milestoneListeners = this.milestoneListeners.filter((l) => l !== fn);
    };
  }

  agent(payload: AgentStatusPayload): void {
    this.history.push(payload);
    for (const fn of this.listeners) fn(payload);
  }

  milestone(payload: FirstSalePayload): void {
    this.milestones.push(payload);
    for (const fn of this.milestoneListeners) fn(payload);
  }

  /** Helper: membangun payload PRD §5.1 dari ringkasan aksi agen. */
  static payload(input: EmitAgentInput): AgentStatusPayload {
    const coordinates = ZONE_COORDINATES[input.zone ?? AGENT_HOME_ZONE[input.agentId]];
    const payload: AgentStatusPayload = {
      runId: input.runId,
      agentId: input.agentId,
      division: AGENT_DIVISION[input.agentId],
      currentAction: input.action,
      targetZone: input.zone ?? AGENT_HOME_ZONE[input.agentId],
      coordinates,
      logMessage: input.logMessage,
      telemetry: input.telemetry,
      timestamp: timestampMs(),
    };
    if (input.iterationCycle) payload.iterationCycle = input.iterationCycle;
    return payload;
  }
}

/** Emitter hening untuk unit test. */
export const silentEmitter: Emitter = { agent: () => {}, milestone: () => {} };

export function createEmitter(): EventBus {
  return new EventBus();
}
