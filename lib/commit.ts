import { execFileSync } from 'node:child_process'

/** Ответ на случай, когда номер коммита взять неоткуда. Не пустая строка и не ноль. */
const UNKNOWN = 'неизвестно'

/** Спрашивает номер коммита у git в текущей рабочей копии. */
function readGitHead(): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return null
  }
}

/**
 * Номер коммита, из которого собрано приложение.
 *
 * Сначала спрашиваем хост: на развёртывании Vercel сам подставляет `VERCEL_GIT_COMMIT_SHA`.
 * Если хост промолчал — а пустая строка это тоже молчание, а не ответ — спрашиваем git
 * в рабочей копии. Если не ответил и он, честно говорим, что номер неизвестен.
 */
export function resolveCommit(gitHead: () => string | null = readGitHead): string {
  const fromHost = process.env.VERCEL_GIT_COMMIT_SHA?.trim()
  if (fromHost) return fromHost

  const fromGit = gitHead()?.trim()
  if (fromGit) return fromGit

  return UNKNOWN
}
