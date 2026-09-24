import { AuthRepository } from "./auth.repo.js";
import { AuthService } from "./auth.service.js";
import { AuthController } from "./auth.controller.js";
import { LoginRateLimiter, RedisRateLimitStore } from "./login-rate-limit.js";

const service = new AuthService(
  new AuthRepository(),
  new LoginRateLimiter(new RedisRateLimitStore()),
);
export const authController = new AuthController(service);
