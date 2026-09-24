import pino from "pino";
import { logSerializers } from "./serializers";

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  ...logSerializers,
});
