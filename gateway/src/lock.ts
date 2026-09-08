export function createMutex(): <T>(fn: () => Promise<T>) => Promise<T> {
  let chain: Promise<void> = Promise.resolve();
  return (fn) => {
    const run = chain.then(fn);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}
