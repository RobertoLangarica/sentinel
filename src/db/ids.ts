import { randomBytes } from 'node:crypto';

// Short hex id + human alias. No external deps.
const ADJ = ['brave', 'calm', 'swift', 'sharp', 'keen', 'bold', 'wise', 'lucid'];
const NOUN = ['hawk', 'review', 'check', 'scan', 'audit', 'lint', 'guard', 'probe'];

export function generateRunId(): string {
  const short = randomBytes(2).toString('hex');           // e.g. "a3f2"
  const a = ADJ[Math.floor(Math.random() * ADJ.length)];
  const n = NOUN[Math.floor(Math.random() * NOUN.length)];
  return `${short}-${a}-${n}`;                            // "a3f2-keen-check"
}
