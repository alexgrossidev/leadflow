/**
 * Groups any (async) iterable into arrays of `size`. Because it is a pull-based
 * generator, the producer only advances when the consumer asks for the next
 * batch: backpressure falls out of `for await` instead of 'drain' bookkeeping.
 */
export async function* batched<T>(
  source: AsyncIterable<T> | Iterable<T>,
  size: number,
): AsyncGenerator<T[]> {
  if (!Number.isInteger(size) || size < 1) {
    throw new RangeError(`batch size must be a positive integer, got ${size}`);
  }
  let batch: T[] = [];
  for await (const item of source) {
    batch.push(item);
    if (batch.length >= size) {
      yield batch;
      batch = [];
    }
  }
  if (batch.length > 0) yield batch;
}
