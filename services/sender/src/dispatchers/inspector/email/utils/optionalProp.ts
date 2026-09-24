export function optionalProp<K extends string, V>(
  key: K,
  value: V | undefined,
): Record<K, V> | {} {
  if (value === undefined) {
    return {};
  }

  return {
    [key]: value,
  } as Record<K, V>;
}
