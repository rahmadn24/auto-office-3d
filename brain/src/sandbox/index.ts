import type { Config } from '../config';
import { E2BSandbox } from './e2b';
import { LocalSandbox } from './local';
import type { SandboxDriver } from './types';

export * from './types';
export * from './guard';
export { LocalSandbox } from './local';

export function createSandbox(config: Config): SandboxDriver {
  if (config.sandboxDriver === 'e2b') {
    if (!config.e2bApiKey) throw new Error('SANDBOX_DRIVER=e2b but E2B_API_KEY is missing');
    return new E2BSandbox(config.e2bApiKey);
  }
  return new LocalSandbox(config.sandboxTimeoutMs);
}
