import { useCallback, useLayoutEffect, useRef } from "react";

/**
 * A callback whose identity never changes but which always runs the latest `fn`. Props built
 * from it let memoized children (the rail, the thread list) skip the re-render a streamed token
 * causes in the chat screen around them.
 */
export function useStableCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: A) => ref.current(...args), []);
}
