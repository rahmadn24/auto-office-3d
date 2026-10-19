import type { Config } from '../config';
import { DockerDeploy } from './dockerdeploy';
import { ResendEmail, StubEmail, type EmailDriver } from './email';
import { LiveGitHub, LocalGitHub, type GitHubDriver } from './github';
import { HttpHealthProbe, OfflineHealthProbe, type HealthProbe } from './health';
import { LiveSocial, StubSocial } from './social';
import type { SocialDriver } from './types';
import { LiveVercel, LocalVercel, type DeployDriver } from './vercel';

export * from './types';
export { DockerDeploy } from './dockerdeploy';

export function createGitHub(config: Config): GitHubDriver {
  return config.githubToken ? new LiveGitHub(config.githubToken) : new LocalGitHub();
}

export function createDeploy(config: Config): DeployDriver {
  if (config.deployDriver === 'vercel') return new LiveVercel(config.vercelToken ?? '');
  if (config.deployDriver === 'docker') {
    return new DockerDeploy({
      publishHost: config.deployPublishHost,
      probeHost: config.deployProbeHost,
    });
  }
  return new LocalVercel();
}

/**
 * Health probe: driver nyata (fetch) bila ada live_url — dipakai setelah deploy;
 * untuk self-test lokal probe menembus http://localhost:4800/health.
 */
export function createHealthProbe(config: Config, liveUrl?: string): HealthProbe {
  if (liveUrl) return new HttpHealthProbe();
  return config.deployDriver === 'vercel' || config.deployDriver === 'docker'
    ? new HttpHealthProbe()
    : new OfflineHealthProbe();
}

export function createEmail(config: Config): EmailDriver {
  return config.emailDriver === 'resend'
    ? new ResendEmail(config.resendApiKey ?? '')
    : new StubEmail();
}

export function createSocial(config: Config): SocialDriver {
  return config.socialDriver === 'live'
    ? new LiveSocial({
        xBearerToken: config.xBearerToken,
        threadsAccessToken: config.threadsAccessToken,
      })
    : new StubSocial();
}

/** Menyusun thread pengumuman peluncuran + hook viral (PRD §3.4). */
export function composeLaunchThread(input: {
  projectName: string;
  founderPrompt: string;
  liveUrl: string;
}): { thread: string[]; hook: string } {
  const hook = `🚀 We just shipped ${input.projectName} — autonomously, end-to-end. Zero humans in the deploy loop.`;
  const thread = [
    hook,
    `1/ A single founder prompt became a running product at https://${input.liveUrl}`,
    `2/ Spec → code → tests → deploy → first customer, all driven by an autonomous agent team.`,
    `3/ "${input.founderPrompt.slice(0, 120)}"`,
    '4/ Build-in-public, from idea to $29 ARR without a manual approval click. Follow along.',
  ];
  return { thread, hook };
}
