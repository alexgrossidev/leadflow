import { GoogleController } from "./google.controller";
import { GoogleService } from "./google.service";

/** Production wiring; tests build a controller around an injected service. */
export function createGoogleController(): GoogleController {
  return new GoogleController(new GoogleService());
}
