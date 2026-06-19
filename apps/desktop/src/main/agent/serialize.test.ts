import { describe, expect, it } from "vitest";
import { createSerializer } from "./serialize.js";

describe("createSerializer", () => {
	it("runs ops strictly in submission order (no interleaving)", async () => {
		const run = createSerializer();
		const order: number[] = [];
		const make = (n: number, delay: number) =>
			run(async () => {
				// A later-submitted op with a shorter delay must still run after the earlier one.
				await new Promise((r) => setTimeout(r, delay));
				order.push(n);
			});
		const a = make(1, 20);
		const b = make(2, 5);
		const c = make(3, 0);
		await Promise.all([a, b, c]);
		expect(order).toEqual([1, 2, 3]);
	});

	it("does not break the chain when an op rejects (a later op still runs)", async () => {
		const run = createSerializer();
		const order: string[] = [];
		const ok1 = run(async () => {
			order.push("ok1");
		});
		const bad = run(async () => {
			throw new Error("boom");
		});
		const ok2 = run(async () => {
			order.push("ok2");
		});
		await expect(bad).rejects.toThrow("boom");
		await Promise.all([ok1, ok2]);
		// The rejection surfaced only to `bad`'s caller; ok1 and ok2 both ran in order.
		expect(order).toEqual(["ok1", "ok2"]);
	});

	it("returns each op's own resolved value to its caller", async () => {
		const run = createSerializer();
		const a = run(async () => 1);
		const b = run(async () => "two");
		expect(await a).toBe(1);
		expect(await b).toBe("two");
	});
});
