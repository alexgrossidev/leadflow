/**
 * Matching is case-insensitive substring, so a keyword also catches its
 * inflections ("cheaper" for "cheap"). Over-blocking is deliberate: the tenant
 * banned a word, and Italian — the most common customer language — inflects too
 * heavily for whole-word matching to hold. The model is told what it hit and
 * writes the reply again, so a false positive costs an iteration, not a reply.
 */
export const findForbiddenKeyword = (
  text: string,
  keywords: readonly string[],
): string | undefined => {
  const haystack = text.toLowerCase();
  return keywords.find((keyword) => haystack.includes(keyword.toLowerCase()));
};
