# Los subagentes autónomos no escriben en git

Cualquier instancia de IA (Claude Code, Codex CLI, o cualquier otra herramienta soportada) que se ejecute como agente autónomo dentro de este proyecto — workers, reviewers, adversarial reviewers, validadores y, en general, cualquier subagente lanzado por una skill, una orquestación o por la sesión principal — tiene prohibido ejecutar comandos git que modifiquen el estado del repositorio. Solo puede leer git, y solo cuando lo necesite para su tarea.

La única instancia exenta es la sesión interactiva con el usuario, que sí puede ejecutar git de escritura cuando el usuario lo pide explícitamente en esa misma sesión.

## A quién aplica

- **Sujeto a la regla:** todo subagente lanzado mediante el mecanismo de subagentes del AI tool (en Claude Code, la tool `Agent` con cualquier `subagent_type`; en Codex CLI, el equivalente cuando exista), todo proceso de AI tool lanzado por una skill o por el comando `implement` como worker/reviewer/prep/validator/detect, y cualquier instancia que opere sin un humano respondiendo turno a turno.
- **Exento:** la sesión interactiva en la que el usuario está conversando con el AI tool. Esa sesión puede ejecutar comandos git de escritura cuando el usuario los pide explícitamente. Una orden inferida o anticipada por Claude no cuenta como orden explícita.

Un subagente no hereda permiso para escribir en git por el hecho de que la sesión que lo lanzó sí lo tuviera. La prohibición es por rol, no por cadena de invocación.

## Qué cuenta como lectura (permitido)

Operaciones que no modifican working tree, index, refs locales, stash, reflog, hooks ni configuración del repositorio. Por ejemplo:

- `git status`, `git diff`, `git log`, `git show`, `git blame`
- `git branch` (listar), `git tag` (listar), `git worktree list`
- `git ls-files`, `git ls-tree`, `git cat-file`, `git rev-parse`, `git rev-list`
- `git config --get` (lectura), `git remote -v` (lectura)

## Qué cuenta como escritura (prohibido)

Cualquier operación que modifique el estado local del repositorio, incluso si no toca la red. Por ejemplo, y sin que la lista sea cerrada:

- Staging e index: `git add`, `git rm`, `git mv`, `git restore --staged`, `git reset` (cualquier variante)
- Commits y reescritura de historia: `git commit`, `git commit --amend`, `git rebase`, `git cherry-pick`, `git revert`, `git merge`
- Refs y ramas: `git branch` (crear/renombrar/borrar), `git tag` (crear/borrar), `git switch -c`, `git checkout -b`
- Working tree: `git checkout <path>`, `git restore <path>`, `git clean`
- Stash y worktrees: `git stash` (cualquier subcomando), `git worktree add`, `git worktree remove`
- Configuración y hooks: `git config` (escritura), edición de ficheros bajo `.git/`
- Cualquier comando remoto (ya prohibido por la regla global del usuario): `git push`, `git pull`, `git fetch`, `git clone`

Tampoco está permitido lograr el mismo efecto por vías alternativas: editar `.git/HEAD`, `.git/index`, `.git/refs/*`, ejecutar `git` mediante un wrapper, invocar APIs de git de una librería, o pedirle a otra tool que ejecute el comando por debajo.

## Qué hace el subagente cuando "haría falta" un git de escritura

Cuando el subagente detecte que su tarea requiere un cambio en git (commit, stage, merge, etc.), debe terminar su trabajo dejando el árbol modificado tal cual y reportarlo al invocador en su mensaje final. Es responsabilidad del invocador — sesión interactiva del usuario u orquestador equivalente — decidir si materializa ese cambio en git.

El subagente no debe pedir permiso al usuario para hacer el commit él mismo: simplemente no lo hace.

## Señales de incumplimiento

Una ejecución viola esta regla cuando, dentro de un subagente sujeto a la regla, aparece cualquiera de lo siguiente:

- Una llamada a la tool `Bash` (o equivalente) cuyo comando empiece por `git ` y no esté en la lista de lectura de arriba.
- Una edición directa a cualquier fichero bajo `.git/`.
- Un commit, stage, branch, tag, stash o reset hecho a través de una librería o wrapper en vez de la CLI de git.
- Un mensaje del subagente al invocador del estilo "he hecho commit de X" o "he dejado staged Y".

Si alguna de estas señales aparece, el comportamiento es incorrecto aunque el resultado final sea el esperado.
