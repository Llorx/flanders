# Terminal-geometry behavior is tested against a headless terminal emulator's rendered grid

A test that verifies how terminal output is **rendered on screen** — the number of physical rows it occupies, line wrapping, what remains after a resize/reflow, cursor position, or the result of a multi-row clear — verifies it by feeding the bytes the code emits into a **headless terminal emulator** and asserting on the emulator's **rendered grid** (the cell/row contents after parsing). It does not rely solely on a string-concatenating fake output that stores the raw bytes, and it does not rely solely on matching the raw escape sequences emitted.

A string-concatenating fake models neither autowrap nor resize-reflow nor cursor motion, so a rendered-geometry claim asserted only against it can pass while the real terminal shows something different (extra rows, stale rows, misaligned content). The rendered grid produced by a terminal emulator from the emitted bytes is the behavioral surface that such a claim is actually about.

The project's headless terminal emulator is **`@xterm/headless`**, declared under `devDependencies`. A test drives it by writing the emitted bytes into the emulator, resizing it through its resize API to exercise reflow, and reading back the rendered rows from its active buffer.

## Who this applies to

- **Subject:** test files under `src/` (`*.test.ts`).
- **Scope:** any test whose correctness claim is about the rendered terminal geometry of a live, terminal-pinned region or of output whose layout depends on the terminal — specifically the bottom-fixed live block (`BottomBlock`) and any other code that draws or clears a multi-line terminal region, moves the cursor, or depends on line wrapping or resize-reflow. A rendered-geometry claim for such code is verified against the emulator's rendered grid.
- **Out of scope:** tests of pure logic and of pure string-formatting (for example, width-fitting a single line to a column count, token/time formatting) that make no claim about the rendered terminal grid. These keep asserting on returned values or captured output directly.

## Relationship to other testing rules

- `arrange-act-assert` remains the only test runner (`library-and-aaa-structure.md`); the emulator is a helper used inside the `ARRANGE`/`ASSERT` sections of an `arrange-act-assert` test, never a second runner.
- The emulator is a development-only dependency, so it does not add a production dependency (`no-production-dependencies.md`).
- Asserting on the emulator's rendered grid is asserting through the behavioral surface, consistent with `assert-via-public-surface.md`: the grid is computed from the bytes the code emits, not from its private state or its source text. Asserting the exact emitted control sequences against a captured-output fake remains permitted and complementary; this rule binds only the rendered-geometry claim, which must additionally be confirmed against the emulator grid.

## Failure signals

- A test asserts "the block stays N rows after a resize", "the line wraps / does not wrap", "no stale row remains", or "the cursor lands here" by inspecting a concatenated string of emitted bytes instead of an emulator-rendered grid.
- A rendered-geometry regression ships green because the only resize/wrapping test runs against a fake that cannot wrap or reflow.
- A test reaches for a terminal emulator other than the project's declared one, or adds the emulator under production `dependencies` rather than `devDependencies`.
