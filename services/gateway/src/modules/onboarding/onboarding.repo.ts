import { mainDb } from "#database/mainPool";
import { onboarding, NewOnboarding } from "./onboarding.table.js";

export class OnboardingRepository {
  /**
   * Idempotent write keyed on the unique user_id constraint — a retried or
   * double-clicked save resolves to the same row instead of a duplicate.
   */
  async upsert(input: NewOnboarding): Promise<void> {
    const set: Partial<NewOnboarding> = {
      data: input.data,
      completed: input.completed,
    };
    if (input.tempId !== undefined) set.tempId = input.tempId;

    await mainDb.insert(onboarding).values(input).onDuplicateKeyUpdate({ set }).execute();
  }
}
