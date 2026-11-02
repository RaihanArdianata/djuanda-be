/**
 * Mengumpulkan event beberapa milidetik lalu mengirimnya sekaligus. Dipakai untuk meneruskan track
 * ke alert-service tanpa menunggu penulisan database, yang jauh lebih lambat (database ada di
 * mesin lain) dan memperlambat semuanya bila dijadikan satu antrean.
 */
export interface PublishBuffer<T> {
  add(item: T): void;
  /** Kirim sekarang apa pun yang menunggu. */
  flush(): Promise<void>;
  readonly pending: number;
}

export function createPublishBuffer<T>(opts: {
  intervalMs: number;
  publish: (batch: T[]) => Promise<void>;
  onError: (err: unknown, size: number) => void;
}): PublishBuffer<T> {
  const items: T[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = async (): Promise<void> => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const batch = items.splice(0);
    if (batch.length === 0) return;
    try {
      await opts.publish(batch);
    } catch (err) {
      opts.onError(err, batch.length);
    }
  };

  return {
    add(item: T): void {
      items.push(item);
      if (timer) return;
      timer = setTimeout(() => {
        void flush();
      }, opts.intervalMs);
      timer.unref?.();
    },
    flush,
    get pending(): number {
      return items.length;
    },
  };
}
