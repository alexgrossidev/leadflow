/**
 * Whose limits, pacing and WhatsApp session a message uses: the contact's
 * assigned user when the business runs in multiseat mode, else the sender.
 */
export async function resolveSenderUserId(
  multiseat: { isEnabled(businessId: number): Promise<boolean> },
  businessId: number,
  userId: number,
  assignedToUserId?: number,
): Promise<number> {
  if (!assignedToUserId) return userId;
  return (await multiseat.isEnabled(businessId)) ? assignedToUserId : userId;
}
