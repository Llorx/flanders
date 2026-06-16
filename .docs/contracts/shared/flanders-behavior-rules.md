# Flanders Behavior Rules — `.spec/flanders`

## Purpose
Pin where a project records the rules that govern Flanders' own command behavior, and Flanders' commitment to honor them. A behavior rule constrains how Flanders acts when it works in the project — how its commands and skills name, place, organize, or otherwise produce the files and changes they author — as distinct from `.spec/contracts` and `.spec/rules`, which describe the host project's own code rather than Flanders' behavior. The `.spec` layout these folders sit in is pinned in [.docs/contracts/shared/spec-folder-layout.md](/.docs/contracts/shared/spec-folder-layout.md).

## Where behavior rules live
A behavior rule lives in a `.spec/flanders` folder: a subfolder named exactly `flanders` inside a `.spec` folder, alongside that scope's `contracts/` and `rules/` subfolders. A `.spec/flanders` folder may appear in any `.spec` folder at any level of the project tree — at the project root and inside any other directory.

Flanders treats every file inside a `.spec/flanders` folder, at any depth, as a behavior rule of that folder and reads them all; the folder's behavior rules can therefore be organized into subfolders within it.

## Scope
A `.spec/flanders` folder scopes the directory that contains its `.spec` folder: its behavior rules govern the Flanders actions whose target falls within that directory and everything beneath it. A behavior rule in the project-root `.spec/flanders` governs Flanders actions anywhere in the project; a behavior rule in a nested `.spec/flanders` governs only the Flanders actions whose target falls within the scope of the directory that nested `.spec` folder scopes. The target of an action is the file or directory that the action creates, modifies, or otherwise concerns. The behavior rules that govern an action are every behavior rule whose scope encloses that action's target.

## Reading and honoring
When a Flanders command or skill is about to perform work, it reads every behavior rule whose scope encloses that work's target and honors all of them while performing the work. A behavior rule in scope is binding on the work it governs: Flanders carries out that work in conformance with the rule, not at its own discretion.
