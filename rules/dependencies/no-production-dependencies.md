# No Production Dependencies

The project must declare **zero entries** under `dependencies` in `package.json`.

If, **during planning**, a step would require adding a runtime dependency
(i.e. an entry under `dependencies` — equivalently, any future
`npm install <pkg>` that is not `--save-dev`, `--save-peer`, or
`--save-optional`), the planner **must** raise the question to the user and
wait for an explicit approval before the plan is finalized. Implementation
must never ask: by the time the plan reaches the implementer, every required
runtime dependency has already been approved (or the plan has been reshaped
to avoid one).

## In scope
- The `dependencies` field of `package.json`.
- Any plan step whose execution would write to that field.

## Out of scope
- `devDependencies` — may be planned and installed freely.
- `peerDependencies` and `optionalDependencies` — not covered by this rule.

## How to raise it during planning
When a runtime dependency looks necessary, the planner halts and asks the
user for approval before finalizing the plan. The question must include:
1. The package name and intended version range.
2. The concrete need it solves.
3. Alternatives considered (Node stdlib, vendoring, dropping the feature,
   or moving the work to a devDep).

On approval, the plan records the dependency and the implementer installs
it without further questions. On rejection, the plan is reshaped to use a
stdlib- or vendor-based solution; the implementer never revisits this
decision.
