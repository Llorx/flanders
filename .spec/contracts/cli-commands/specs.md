# `specs` Command Contract

## Purpose
Report which spec files govern a given set of paths, and optionally the headings those files carry, so that a caller learns the obligations reaching a path without opening a single spec file. The answer is derived from the project tree alone: the command makes no AI invocation, reads no Flanders configuration, and writes nothing.

## Invocation

    npx flanders specs [--titles] <path>...

- At least one `<path>` is required. Invoked with none, the command exits non-zero with a usage message naming the missing argument.
- Each `<path>` names a location whose governing specs the caller wants. A path that resolves to an existing directory is searched from that directory itself; every other path — including one that no longer exists on disk, such as a file a change deleted — is searched from the directory that contains it.
- `--titles` extends the output with the headings of every reported spec file, per [Output](#output).

## Which specs are reported
For each searched directory, the command inspects that directory and every directory above it, up to and including the filesystem root, and reports every file inside a `.spec` folder it finds along the way. This is the ancestor half of the scope model of [.spec/contracts/shared/spec-folder-layout.md](/.spec/contracts/shared/spec-folder-layout.md): a `.spec` folder scopes the directory that contains it and everything beneath it, so the `.spec` folders at and above a path are exactly those whose specs reach it. The walk continues above the project root, so a `.spec` folder placed in a directory that encloses the project governs the project's files and is reported for them.

A `.spec` folder that the ignore rules of a git repository containing it exclude contributes nothing; every other `.spec` folder the walk reaches contributes all of its files.

Each file is reported by its path alone, with no grouping or labelling by the `.spec` subfolder it sits in — the reported path already states whether the file is a contract, a rule, or a behavior rule.

## Output
The output is written to standard output as plain lines, and is the same whichever paths were passed in whichever order:

- One line per reported spec file, holding that file's path relative to the current working directory, with `/` as the separator and a leading `../` for each level the file sits above that directory. A file reached from more than one of the given paths is reported once.
- Files are ordered by the `.spec` folder that holds them, deepest folder first, and within a folder in ascending path order.
- With `--titles`, each file's path line is followed by that file's headings, one per line, each reproduced exactly as written in the file including its leading `#` characters, in document order. Which lines are headings is pinned by [.spec/contracts/shared/spec-section-model.md](/.spec/contracts/shared/spec-section-model.md). A file that carries no heading contributes only its path line.

A path line never begins with `#` and a heading line always does, so a reader separates the two without any further delimiter.

When no `.spec` folder is found for any given path, the command writes nothing and exits successfully. Every other successful invocation also exits successfully; the only non-zero exit is the usage error above.
