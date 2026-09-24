import {
  HumanReadableErrorMessages,
  HumanReadablePhoneErrors,
  type CleanDataResult,
} from "#dispatchers/processor/types";
import { cleanEmailInput } from "./clean.email";
import { cleanWhatsAppNumber } from "./clean.whatsapp";

export function cleanData(type: "whatsapp" | "email", rawData: string | undefined): CleanDataResult {
  if (type === "email") {
    return rawData ? cleanEmailInput(rawData) : { success: false, error: HumanReadableErrorMessages.EMPTY_INPUT };
  }
  return rawData ? cleanWhatsAppNumber(rawData) : { success: false, error: HumanReadablePhoneErrors.EMPTY_INPUT };
}
