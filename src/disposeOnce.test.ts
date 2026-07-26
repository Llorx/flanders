import * as Assert from "assert";

import test from "arrange-act-assert";

import { disposeOnce } from "./disposeOnce";

test.describe("disposeOnce", test => {
    function heldTearDown() {
        const state:{ runs:number; finished:boolean; release:(() => void)|null } = { runs: 0, finished: false, release: null };
        const dispose = disposeOnce(async () => {
            state.runs++;
            await new Promise<void>(resolve => { state.release = resolve; });
            state.finished = true;
        });
        return { dispose, state };
    }

    test("a concurrent second call joins the teardown in flight instead of resolving ahead of it", {
        ARRANGE() {
            return heldTearDown();
        },
        async ACT({ dispose, state }) {
            const first = dispose();
            const second = dispose();
            const finishedWhileInFlight = state.finished;
            state.release!();
            await second;
            return { finishedWhileInFlight, finishedAfterSecond: state.finished, sameDisposal: first === second, runs: state.runs };
        },
        ASSERTS: {
            "the teardown has not finished while it is still in flight"({ finishedWhileInFlight }) {
                Assert.strictEqual(finishedWhileInFlight, false);
            },
            "awaiting the second call observes the finished teardown"({ finishedAfterSecond }) {
                Assert.strictEqual(finishedAfterSecond, true);
            },
            "both callers hold one and the same disposal"({ sameDisposal }) {
                Assert.strictEqual(sameDisposal, true);
            },
            "the teardown runs once"({ runs }) {
                Assert.strictEqual(runs, 1);
            }
        }
    });

    test("a call made after the teardown settled does not run it again", {
        ARRANGE() {
            return heldTearDown();
        },
        async ACT({ dispose, state }) {
            const first = dispose();
            state.release!();
            await first;
            await dispose();
            return state.runs;
        },
        ASSERT(runs) {
            Assert.strictEqual(runs, 1);
        }
    });

    test("a teardown that rejects hands the same failure to every caller", {
        ARRANGE() {
            const failure = new Error("teardown blew up");
            let runs = 0;
            const dispose = disposeOnce(async () => {
                runs++;
                throw failure;
            });
            return { dispose, failure, getRuns: () => runs };
        },
        async ACT({ dispose }) {
            const caught:unknown[] = [];
            const collect = (e:unknown) => { caught.push(e); };
            await Promise.all([dispose().catch(collect), dispose().catch(collect)]);
            return caught;
        },
        ASSERTS: {
            "both callers see the failure"(caught, { failure }) {
                Assert.deepStrictEqual(caught, [failure, failure]);
            },
            "the teardown still ran once"(_caught, { getRuns }) {
                Assert.strictEqual(getRuns(), 1);
            }
        }
    });
});
