import type { FacebookExchangeTokenPayload } from "@leadflow/shared/jobs";
import { TokenExchangeDispatcher } from "./token/token.dispatcher";

const dispatcher = new TokenExchangeDispatcher();

export async function TOKEN_EXCHANGE_PROCESS(
  payload: FacebookExchangeTokenPayload,
): Promise<void> {
  return dispatcher.run(payload);
}
