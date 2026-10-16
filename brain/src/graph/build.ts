import {
  END,
  MemorySaver,
  START,
  StateGraph,
  type BaseCheckpointSaver,
} from '@langchain/langgraph';

import { decideBreaker } from './breaker';
import {
  devNode,
  devopsNode,
  founderNode,
  growthNode,
  pmNode,
  qaNode,
  safeBuildNode,
  type GraphDeps,
} from './nodes';
import { RunStateSchema, type RunState } from './state';

export interface BuildOptions {
  /**
   * Checkpointer (PRD — "Graph bisa dijalankan ulang dari state tersimpan").
   * Bila diberikan, setiap langkah node disimpan per `thread_id` sehingga run
   * bisa dilanjutkan lewat `resumeRun`/`app.invoke(null, {configurable})`.
   */
  checkpointer?: BaseCheckpointSaver;
}

/**
 * Graf siklus LangGraph — PRD §3.
 *
 *   START → founder → pm → dev ⇄ qa ─┬─ pass ───────────────→ devops → growth → END
 *                                   ├─ fail & < max ──────→ dev (retry)
 *                                   └─ fail & cycle ke-5 ──→ safebuild → devops
 */
export function buildOrchestrator(deps: GraphDeps, options: BuildOptions = {}) {
  const graph = new StateGraph(RunStateSchema)
    .addNode('founder', founderNode(deps))
    .addNode('pm', pmNode(deps))
    .addNode('dev', devNode(deps))
    .addNode('qa', qaNode(deps))
    .addNode('safebuild', safeBuildNode(deps))
    .addNode('devops', devopsNode(deps))
    .addNode('growth', growthNode(deps));

  graph.addEdge(START, 'founder');
  graph.addEdge('founder', 'pm');
  graph.addEdge('pm', 'dev');
  graph.addEdge('dev', 'qa');

  graph.addConditionalEdges(
    'qa',
    (state: RunState) =>
      decideBreaker({
        qaPassed: state.qaPassed,
        iteration: state.iteration,
        maxIterations: state.maxIterations,
      }),
    {
      retry: 'dev',
      fallback: 'safebuild',
      deploy: 'devops',
    },
  );

  graph.addConditionalEdges(
    'safebuild',
    (state: RunState) => (state.stage === 'failed' ? END : 'devops'),
    ['devops', END],
  );

  graph.addEdge('devops', 'growth');
  graph.addEdge('growth', END);

  return graph.compile(options.checkpointer ? { checkpointer: options.checkpointer } : {});
}

export type Orchestrator = ReturnType<typeof buildOrchestrator>;

export { MemorySaver };
