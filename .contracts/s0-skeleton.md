# s0-skeleton — a Next.js application whose /health page names the commit it was built from

## Paths

```
package.json
package-lock.json
next.config.ts
tsconfig.json
eslint.config.mjs
vitest.config.ts
app/
lib/
__tests__/
.github/workflows/ci.yml
.gitignore
```

## Result

The repository holds a Next.js application and nothing else. `npm run dev` serves it, `/health`
answers with the git SHA of the commit the running build was made from, and the `ci` check
installs the project, lints it, runs its tests and builds it.

## Problem

There is no application. `ls` in this repository returns `README.md`, `CLAUDE.md`, `.gitignore`
and `.github/workflows/ci.yml` and no source file, no `package.json` and no lockfile. The `ci`
workflow's three steps each guard on `[ -f package.json ]` and print `приложения ещё нет —
ставить нечего`, `команды lint ещё нет` and `команды test ещё нет`, so the job reports success
on any commit whatsoever, including one whose tests do not run at all. Nothing in this repository
already solves this: there is no prior art to duplicate, because there is no code.

## Preserve

- The workflow's job must keep reporting under the check name `ci`. Branch protection on `main`
  requires a status check whose context is exactly `ci`, read from the protection settings of
  this repository rather than assumed. Splitting the job in two, or renaming it, removes the
  context the gate waits for, and a required check that never starts blocks every merge into
  `main` from then on with no failing run to point at.
- `.github/workflows/ci.yml` is rewritten in place; its triggers stay as they are — pull requests
  and pushes to `main`.
- `README.md` and `CLAUDE.md` are out of scope and are not touched.
- The application does nothing beyond what `Result` names: no database, no client for either data
  source, no ingester, no fact tables, no metrics layer, and no screen other than `/health` and
  whatever root page the framework needs in order to build.
- Secrets stay out of git. `.env.local` is already ignored and stays ignored; nothing this task
  adds reads it.

## Consequence

Nothing in this repository calls anything, because this repository contains no code: the callers
were looked for by reading every file in the tree, and the tree is four files. The one existing
artefact this task changes is `.github/workflows/ci.yml`, and its caller is GitHub's branch
protection on `main`, which requires the check context `ci` and requires every review
conversation resolved and a linear history.

The first night after the merge, a Vercel production deployment is built from `main` on every
push and `/health` answers over the internet with that commit's SHA; before this merge there is
no deployment and no application to deploy. Exit codes change for the `ci` job: it now fails when
the install, the linter, the tests or the build fails, where before it could only fail if the
runner itself did.

Three things must be true outside this repository, and the operator makes them true by hand: the
repository is connected to a Vercel project; **Enable access to System Environment Variables** is
checked in that project's environment-variable settings, because Vercel documents system
variables as exposed only once that box is ticked, and without it `VERCEL_GIT_COMMIT_SHA` never
reaches the build and `/health` will honestly answer `неизвестно`; and the Vercel project builds
with Node.js 20.9 or newer, which Next.js 16 requires. No migration, no backfill, no variable
this repository has to set itself.

## Done

A criterion holds only when the proof it names fails if the behaviour is wrong — not when a
test asserts that a name exists, that a shape parses, or that two literals agree with each other.

1. **The commit the host names is the commit the page shows.** A test in `__tests__/` gives the
   commit resolver in `lib/` an environment whose `VERCEL_GIT_COMMIT_SHA` is a known SHA that is
   not this checkout's `HEAD`, and asserts the resolver returns that SHA rather than the
   checkout's — the two differ, so a resolver reading the wrong source fails, and so does one
   that reads the right source and ignores it.
   Red when: the assignment in the commit resolver in `lib/` that reads `VERCEL_GIT_COMMIT_SHA`
   is pointed at any other variable name.

2. **With no host variable, the commit comes from git.** The same test file, with
   `VERCEL_GIT_COMMIT_SHA` absent from the environment, asserts the resolver returns exactly what
   `git rev-parse HEAD` prints in this checkout.
   Red when: the branch in the commit resolver in `lib/` that falls back to reading the git head
   is removed.

3. **A number that is not known is said to be not known, and a number that is known is never
   called unknown.** The same test file asserts three cases: with no variable and no readable git
   head the resolver's label is exactly the string `неизвестно`; with `VERCEL_GIT_COMMIT_SHA`
   present but an empty string the label is exactly `неизвестно`, because an empty string is an
   absent answer and not a commit; and with a real SHA present the label is that SHA and is not
   `неизвестно`. The empty string, the empty page and a zero are each a failure of this
   criterion.
   Red when: the guard in the commit resolver in `lib/` that rejects an empty or whitespace-only
   value is removed, so the empty string is returned as if it were an answer.

4. **The page prints what the resolver returned and works nothing out for itself.** A test
   renders `app/health/page.tsx` to static markup and asserts the markup contains the label the
   resolver returns for that same environment, for both a known SHA and the unknown case.
   Red when: the call to the commit resolver inside `app/health/page.tsx` is replaced by a
   literal string.

5. **The checks fail when the code is broken.** The `ci` job runs the install, the linter, the
   tests and the production build, each unconditionally, with none of the `[ -f package.json ]`
   guards or `else echo` fallbacks the file carries today. Proof: two runs of `ci` on this pull
   request, both linked in the body — one red, from a commit that broke a single assertion in
   `__tests__/`, and one green from the commit that restored it.
   Red when: nothing — this criterion is about the checks running, not about behaviour, so there
   is no line of source whose breaking is what it watches for.

6. **The check still answers to the name the merge gate waits for.** The `ci` check appears on
   this pull request as a required check and reaches a conclusion. Proof: the pull request's own
   checks list, pasted into the body with the check's name as GitHub prints it.
   Red when: nothing — this criterion is about the checks running, not about behaviour.

7. `npm run lint`, `npm test` and `npm run build` are green on this checkout and the pull request
   body pastes the real output of each.
   Red when: nothing — this criterion is about the checks running, not about behaviour.

## Source

Vercel, *System environment variables*
(https://vercel.com/docs/environment-variables/system-environment-variables), read 31.08.2026 —
the page states, of `VERCEL_GIT_COMMIT_SHA`:

> **Available at:** Both build and runtime
>
> The git SHA of the commit the deployment was triggered by.
>
> `VERCEL_GIT_COMMIT_SHA=fa1eade47b73733d6312d5abfad33ce9e4068081`

and, under *Enable system environment variables*:

> To enable these environment variables to your deployments:
> 1. Navigate to your project on your dashboard.
> 2. Select **Environment Variables** in the sidebar.
> 3. Select the **Enable access to System Environment Variables** checkbox.

Because the variable is available at build time as well as at runtime, `/health` may read it
while the page is being prerendered; it does not need to be forced dynamic to be correct.

Next.js, *How to upgrade to version 16*
(https://nextjs.org/docs/app/guides/upgrading/version-16), read 31.08.2026:

> ### `next lint` Command
>
> The `next lint` command has been removed. Use Biome or ESLint directly. `next build` no longer
> runs linting.

> | Node.js 20.9+ | Minimum version now `20.9.0` (LTS); Node.js 18 no longer supported |

Next.js, *Installation* (https://nextjs.org/docs/app/getting-started/installation), read
31.08.2026 — the scripts the framework documents for a manual install:

> ```json filename="package.json"
> {
>   "scripts": {
>     "dev": "next dev",
>     "build": "next build",
>     "start": "next start",
>     "lint": "eslint",
>     "lint:fix": "eslint --fix"
>   }
> }
> ```

So `npm run lint` runs the ESLint CLI, never `next lint`, and `npm run build` does not lint on
its own — which is why the workflow has to run the linter as a step of its own.

No vendor page states how the commit is read when the host names nothing; the git fallback and
the `неизвестно` label are this repository's own policy, and criteria 2 and 3 are what settle
them.
