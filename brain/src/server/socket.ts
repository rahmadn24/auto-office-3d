import { createServer, type Server as HttpServer } from 'node:http';

import { Server } from 'socket.io';

import type { Config } from '../config';
import type { EventBus } from '../events';

export interface BrainServer {
  io: Server;
  httpServer: HttpServer;
  port: number;
  url: string;
  close(): Promise<void>;
}

/**
 * Realtime protocol — PRD §2.1 (WebSockets + polling fallback, WSS di produksi)
 * dan PRD §5 (skema event agent:status_update / milestone:first_sale).
 *
 * Endpoint: ws://localhost:4800/brain-server
 */
export async function startSocketServer(config: Config, bus: EventBus): Promise<BrainServer> {
  const httpServer = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, service: 'autooffice3d-brain' }));
      return;
    }
    res.writeHead(404).end();
  });

  const io = new Server(httpServer, {
    path: config.socketPath,
    cors: { origin: '*' },
    transports: ['websocket', 'polling'],
    pingInterval: 10_000,
    pingTimeout: 5_000,
  });

  const offAgent = bus.onAgent((payload) => io.emit('agent:status_update', payload));
  const offMilestone = bus.onMilestone((payload) => io.emit('milestone:first_sale', payload));

  io.on('connection', (socket) => {
    socket.emit('system:hello', {
      service: 'brain',
      version: '1.4',
      drivers: {
        llm: config.llmDriver,
        memory: config.memoryDriver,
        sandbox: config.sandboxDriver,
      },
      limits: { maxIterations: config.maxIterations, tokenBudget: config.tokenBudget },
      socketPath: config.socketPath,
      history: bus.history.slice(-50),
    });

    socket.on('founder:directive', async (prompt: unknown, ack?: (r: unknown) => void) => {
      if (typeof prompt !== 'string' || prompt.trim().length === 0) {
        ack?.({ ok: false, error: 'empty directive' });
        return;
      }
      ack?.({ ok: true, queued: true });
      const { runAutonomous } = await import('../run');
      void runAutonomous(prompt, { config, emit: bus }).catch((err: unknown) => {
        console.error('[brain] autonomous run failed:', err);
      });
    });
  });

  const port = config.port;
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, () => resolve());
  });

  return {
    io,
    httpServer,
    port,
    url: `ws://localhost:${port}${config.socketPath}`,
    async close() {
      offAgent();
      offMilestone();
      await new Promise<void>((resolve) => io.close(() => resolve()));
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}
