import type {
  AgentStatusPayload,
  ArtifactsPayload,
  DeployUpdatePayload,
  FirstSalePayload,
  MemoryRetrievalPayload,
  RevenueUpdatePayload,
  SocialPostPayload,
} from './types';
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
  deploy?(payload: DeployUpdatePayload): void;
  revenue?(payload: RevenueUpdatePayload): void;
  social?(payload: SocialPostPayload): void;
  retrieval?(payload: MemoryRetrievalPayload): void;
  artifacts?(payload: ArtifactsPayload): void;
}

/** Event bus in-process — Socket.io (dan test) tinggal berlangganan di sini. */
export class EventBus implements Emitter {
  private listeners: Array<(p: AgentStatusPayload) => void> = [];
  private milestoneListeners: Array<(p: FirstSalePayload) => void> = [];
  private deployListeners: Array<(p: DeployUpdatePayload) => void> = [];
  private revenueListeners: Array<(p: RevenueUpdatePayload) => void> = [];
  private socialListeners: Array<(p: SocialPostPayload) => void> = [];
  private retrievalListeners: Array<(p: MemoryRetrievalPayload) => void> = [];
  private artifactsListeners: Array<(p: ArtifactsPayload) => void> = [];
  readonly history: AgentStatusPayload[] = [];
  readonly milestones: FirstSalePayload[] = [];
  readonly deployments: DeployUpdatePayload[] = [];
  readonly revenues: RevenueUpdatePayload[] = [];
  readonly socialPosts: SocialPostPayload[] = [];
  readonly retrievals: MemoryRetrievalPayload[] = [];

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

  onDeploy(fn: (p: DeployUpdatePayload) => void): () => void {
    this.deployListeners.push(fn);
    return () => {
      this.deployListeners = this.deployListeners.filter((l) => l !== fn);
    };
  }

  onRevenue(fn: (p: RevenueUpdatePayload) => void): () => void {
    this.revenueListeners.push(fn);
    return () => {
      this.revenueListeners = this.revenueListeners.filter((l) => l !== fn);
    };
  }

  onSocial(fn: (p: SocialPostPayload) => void): () => void {
    this.socialListeners.push(fn);
    return () => {
      this.socialListeners = this.socialListeners.filter((l) => l !== fn);
    };
  }

  onRetrieval(fn: (p: MemoryRetrievalPayload) => void): () => void {
    this.retrievalListeners.push(fn);
    return () => {
      this.retrievalListeners = this.retrievalListeners.filter((l) => l !== fn);
    };
  }

  onArtifacts(fn: (p: ArtifactsPayload) => void): () => void {
    this.artifactsListeners.push(fn);
    return () => {
      this.artifactsListeners = this.artifactsListeners.filter((l) => l !== fn);
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

  deploy(payload: DeployUpdatePayload): void {
    this.deployments.push(payload);
    for (const fn of this.deployListeners) fn(payload);
  }

  revenue(payload: RevenueUpdatePayload): void {
    this.revenues.push(payload);
    for (const fn of this.revenueListeners) fn(payload);
  }

  social(payload: SocialPostPayload): void {
    this.socialPosts.push(payload);
    for (const fn of this.socialListeners) fn(payload);
  }

  retrieval(payload: MemoryRetrievalPayload): void {
    this.retrievals.push(payload);
    for (const fn of this.retrievalListeners) fn(payload);
  }

  artifacts(payload: ArtifactsPayload): void {
    for (const fn of this.artifactsListeners) fn(payload);
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
