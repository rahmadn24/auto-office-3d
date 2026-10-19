#!/usr/bin/env node
/**
 * AutoOffice3D — dev orchestrator: Brain (:4800) + Theater (:3001) sekaligus,
 * pengganti dua terminal. Output digabung dengan prefix [brain]/[theater];
 * Ctrl+C (SIGINT) mematikan keduanya.
 *
 * Override port: BRAIN_PORT=4900 THEATER_PORT=3200 npm run dev
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const brainPort = process.env.BRAIN_PORT ?? '4800';
const theaterPort = process.env.THEATER_PORT ?? '3001';

const services = [
  { name: 'brain  ', color: '\x1b[35m', cwd: join(root, 'brain'), env: { PORT: brainPort } },
  {
    name: 'theater',
    color: '\x1b[36m',
    cwd: join(root, 'theater'),
    env: {
      PORT: theaterPort,
      NEXT_PUBLIC_BRAIN_URL: process.env.NEXT_PUBLIC_BRAIN_URL ?? `http://localhost:${brainPort}`,
    },
  },
];

let shuttingDown = false;
/** @type {import('node:child_process').ChildProcess[]} */
const children = [];

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  }
  // Beri anak proses 1,5 dtk grace, lalu paksa keluar.
  setTimeout(() => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    process.exit(code);
  }, 1_500).unref();
}

for (const svc of services) {
  const child = spawn('npm', ['run', 'dev'], {
    cwd: svc.cwd,
    env: { ...process.env, ...svc.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);

  const tag = `${svc.color}[${svc.name}]\x1b[0m`;
  for (const stream of [child.stdout, child.stderr]) {
    let buffered = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      buffered += chunk;
      let idx;
      while ((idx = buffered.indexOf('\n')) >= 0) {
        console.log(`${tag} ${buffered.slice(0, idx)}`);
        buffered = buffered.slice(idx + 1);
      }
    });
  }

  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.error(`${tag} berhenti (code=${code ?? '-'} signal=${signal ?? '-'}) — mematikan yang lain`);
    shutdown(code ?? 1);
  });
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log(
  `AutoOffice3D dev — brain :${brainPort} + theater :${theaterPort} · Ctrl+C untuk stop keduanya`,
);
