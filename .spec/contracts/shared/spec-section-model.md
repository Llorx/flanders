# Spec Section Model — Shared Contract

## Purpose
Define, once for every Flanders surface that reads a spec file as a set of sections, what counts as a heading in that file, how far a section extends, and what a listing of a file's headings contains. The `specs` command reports headings under this model (see [.spec/contracts/cli-commands/specs.md](/.spec/contracts/cli-commands/specs.md)), and the reference content a surface consolidates for its agents is cut from a file under it.

## Headings
A heading is a line whose first character is `#`, outside a fenced code block. Its level is the number of `#` characters that open the line: one `#` is level 1, two is level 2, and so on.

A fenced code block is opened by a line whose first non-whitespace characters are three backticks and closed by the next such line. Lines inside it are content whatever they begin with, so a shell comment or a markdown example written inside a fence is never a heading.

## Section extent
A heading opens a section that runs from its own heading line down to, but not including, the next heading of the same level or of a lower level number, or to the end of the file when no such heading follows. A heading of a higher level number falls inside the section it follows, so a section carries its own nested subsections whole.

## Preamble
A file's preamble is the content that precedes its first heading. A file whose first line is a heading has an empty preamble.

## Heading listing
A listing of a file's headings names every heading the file carries, at every level, in document order, each reproduced exactly as written including its leading `#` characters. Levels are neither filtered nor renumbered: a listing states the file's heading structure as it stands.
