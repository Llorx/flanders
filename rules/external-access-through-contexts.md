# External access goes through a context interface

When a class needs to reach anything it did not create itself, the access must go through a typed context interface — never through a direct call to a global, a Node built-in, or a concrete class. The class operates against the interface; production wires real implementations and tests wire mocks.

## What "outside world" means here

Three categories of access fall under this rule:

1. **Non-deterministic sources** — anything whose value the class cannot derive from its own state and inputs. Examples: `Date.now()`, `Date()`, `Math.random()`, `crypto.randomUUID()`, `process.env`, `process.argv`, `process.platform`, `os.tmpdir()`, `os.homedir()`.
2. **I/O and side effects** — anything that touches the world outside the process or whose effect persists beyond a function call. Examples: `fs` and `fs/promises`, `child_process.spawn` / `exec`, `http` / `fetch`, `console.log` / `process.stdout` / `process.stderr`, `setTimeout` / `setInterval` / `clearTimeout`, signal handlers, stdin reads.
3. **Injected dependencies** — any collaborating object the class receives from its caller. The dependency must be typed as a context interface, not as the concrete class. A class that depends on `Foo` must accept a `FooContext` (or equivalent interface) — never `Foo` directly — so a test can substitute a stub.

## What is exempt

- **Pure deterministic utility imports** — functions whose output depends only on their arguments and which produce no side effect (e.g., a `joinPath(a, b)` that only concatenates strings, a formatter, a parser). These can be called directly without wrapping.
- **Resources the class creates itself** — objects instantiated inside the class from primitives the class already owns. The class is their owner and can use them directly. (This does not exempt the primitives or contexts used to construct them.)
- **Type-only imports** — importing a `type` or `interface` from another module is not "access" and needs no context.

## How a context interface looks

A context interface declares the minimum surface the class needs, using plain method signatures over standard types. It does not extend or alias a third-party type. Example:

```ts
export interface TimeContext {
    now():number;
    setTimeout(handler:() => void, ms:number):TimeoutHandle;
}
```

The class consumes the interface:

```ts
class TokenBucket {
    constructor(private _time:TimeContext) {}
    refill() {
        const t = this._time.now();
        // ...
    }
}
```

Production wires it to the real source (`Date.now`, `setTimeout`); tests wire it to a stub that returns controlled values.

## What this rule does not pin

- **How the context reaches the consumer** — constructor injection, method parameter, factory function, or any other mechanism is acceptable, as long as the consumer never reaches for the dependency through a global or a concrete class.
- **Where the context interface is declared** — a shared contexts module and a co-located declaration next to its primary owner are both acceptable.
- **Granularity** — splitting a large surface into several small context interfaces, or bundling related operations into one larger interface, is a judgment call made per context.

## Failure signals

A change violates this rule whenever any of the following appears in production class code:

- A direct reference to `Date.now`, `Math.random`, `process.env`, `process.platform`, `os.*`, `crypto.random*`, `setTimeout`, `setInterval`, or similar ambient globals.
- A direct import of `fs`, `fs/promises`, `child_process`, `http`, `https`, `net`, `os`, or other Node I/O modules used at runtime (not type-only).
- A constructor or method parameter typed as a concrete collaborating class instead of as an interface that captures only the methods the consumer actually uses.
- A `console.log` / `console.error` / `process.stdout.write` call from inside a class that has no output context.

When any of these is needed, introduce or extend a context interface and route the access through it.
