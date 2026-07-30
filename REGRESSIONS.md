# Regressions

Known behaviour we knowingly gave up, and what has to land before it stops
being a problem. Anything listed here is a deliberate trade, not a bug — but
none of it is safe to forget.

---

## No execution timeout for user JS in compiled graphs

**Introduced by:** inlining user JS into the compiled graph function
(`packages/blocks/compiler.ts`, `inlineJs` defaults to `true`).

**What was lost.** The interpreted engine runs every user snippet through
`JsVM`, which compiles it with `new Script(...)` and executes it with
`timeout: 4000`. V8 interrupts the script when that elapses, so a runaway
`while (true) {}` in a JS Runner block fails that one request and nothing else.
`runAsync` additionally races async user code against a 4s timer.

Inlined code has neither. It is ordinary JavaScript in the worker's own event
loop, so a synchronous infinite loop **never yields** — the thread stops
serving every other request on it, forever. Nothing inside the process can
preempt it: no timer fires, no promise resolves, no signal handler runs.

**Blast radius today:** whatever shares the thread. One graph with a bad loop
wedges every concurrent request on that worker until an outside observer kills
it.

**What has to land:**

1. **Worker thread + watcher.** Execute compiled graphs in a worker thread and
   supervise from the main thread. `worker.terminate()` *does* interrupt a
   thread spinning in a tight sync loop, so this is the backstop that actually
   works. Track in-flight requests in a `SharedArrayBuffer` — one slot per
   request, `Atomics.store(sab, slot, Date.now())` at start, `0` at completion.
   The watcher scans the slots on a 250–500ms tick and knows exactly how long
   the current request has run and which one it is. Do not infer it from CPU or
   memory: a legitimately slow block looks identical.
2. **Attempt counter / route circuit breaker.** Killing the worker kills every
   in-flight sibling too, and a retried poison request hangs the replacement.
   Without a retry cap, one bad graph eats the pool. The runaway should get a
   504 and its siblings a retryable 503.
3. **Warm spare.** Respawn costs ~10–30ms plus re-importing the compiled graph
   and plugin bundle. Without a standby the pool runs degraded exactly when it
   is under the load that triggered the kill.
4. **(Optional, better) Deadline injection.** Once there is a parser in the
   pipeline — the identifier rewrite that would let us drop `with` needs one
   anyway — inject `if ($deadline()) throw new ExecutionTimeoutError("block b3")`
   into every user-written loop body. That turns "wedged pool" into "this
   request 504s and names the block", deterministically and without involving
   the supervisor. The supervisor then only covers what a parser can't see:
   sync native calls, catastrophic regex backtracking.

**Escape hatch meanwhile:** `compileGraph(blocks, edges, { inlineJs: false })`
keeps every user snippet in the sandbox, timeout included, at roughly the cost
of not having compiled at all (the bubble sort benchmark is 0.99x interpreted
with the VM in the path, 194x with it out).

---

## Prototype pollution now outlives the request

**Introduced by:** the same change.

Ordinary user state is still contained. `ctx.vars` is rebuilt per request by
`setupContextVars()` (`apps/server/src/modules/requestRouter/service.ts`), the
`$scope` proxy sends every bare assignment there, and `var`/`let`/`const`
declarations stay inside the snippet's wrapper function. User code also cannot
name `ctx`, `lib` or `$in` — `with` intercepts every identifier and resolves it
to vars-then-globalThis, so the compiled function's closure is invisible.

What escapes is anything that touches the realm itself:

- `globalThis.foo = 1` — explicit, bypasses the proxy
- `Array.prototype.push = ...` / `Object.prototype.x = ...` — **the one that
  matters**. `runInNewContext` gave every call fresh intrinsics, so pollution
  died with the call. The intrinsics are now the worker's, shared by every
  later request on that thread and every route in the project's pool.
- `setTimeout` callbacks and dangling promises outlive the request and keep
  their `vars` closure alive

No in-realm fix exists — a Proxy cannot protect intrinsics it does not own.
The mitigations are the same ones the timeout needs: a worker thread that gets
recycled, or per-tenant isolates. Recycling a worker every N requests would
bound the damage cheaply if this ever bites.

---

## Sandbox isolation dropped for user JS

**Introduced by:** the same change.

**What was lost.** `runInNewContext` gave user code a fresh V8 realm with no
`process`, no `require`, no access to the host. Inlined code runs in the
worker's own realm. `$scope` deliberately does not expose `ctx` or `lib` by
name — every identifier resolves to `ctx.vars` first, then `globalThis` — but
`globalThis` is the real one, so `process` and friends are reachable.

**Why this is accepted:** Fluxify cloud is per-tenant hosted, one instance per
tenant and a dedicated worker pool per project, so user code already runs
alongside only that user's own code. This is the same trade Vercel-style
platforms make.

**What would change the calculus:** any shared multi-tenant deployment. That
would need per-tenant isolates, and the VM is not the right tool for it either
— dropping it inside an isolate is free.
