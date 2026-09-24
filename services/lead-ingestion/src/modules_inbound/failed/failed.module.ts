import { QueueRecoveryService } from "./failed.service";
import { QueueRecoveryRepository } from "./failed.repo";

const repo = new QueueRecoveryRepository();
export const queueRecoveryClient = new QueueRecoveryService(repo);
