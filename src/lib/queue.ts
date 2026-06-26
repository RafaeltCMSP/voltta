import { Queue, type ConnectionOptions } from 'bullmq';
import { env } from '../config/env.js';

// Deriva a conexão do REDIS_URL como objeto de opções — evita conflito entre
// a cópia de ioredis do BullMQ e uma instância externa.
const url = new URL(env.REDIS_URL);
export const connection: ConnectionOptions = {
  host: url.hostname,
  port: Number(url.port || 6379),
  username: url.username || undefined,
  password: url.password || undefined,
  maxRetriesPerRequest: null,
};

export const RECOVERY_QUEUE = 'recovery';

export interface RecoveryJobData {
  orderId: string;
}

export const recoveryQueue = new Queue<RecoveryJobData, void, string>(RECOVERY_QUEUE, { connection });
