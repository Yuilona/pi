/**
 * A per-instance promise-chain mutex: returns a `runExclusive(fn)` that runs each `fn` strictly after the
 * previous one settles, so lifecycle/map mutations can't interleave. A rejecting op does NOT break the chain
 * (the next op still runs); the rejection surfaces only to that op's own caller. Both `SessionController`
 * (per-session op-lock) and `SessionPool` (the pool map lock) hold one instance.
 */
export function createSerializer(): <T>(fn: () => Promise<T>) => Promise<T> {
	let chain: Promise<unknown> = Promise.resolve();
	return <T>(fn: () => Promise<T>): Promise<T> => {
		const next = chain.then(fn, fn);
		chain = next.then(
			() => {},
			() => {},
		);
		return next;
	};
}
