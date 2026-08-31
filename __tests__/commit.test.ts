import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

import { resolveCommit } from '@/lib/commit'

/** Заведомо не HEAD этой рабочей копии. */
const HOST_SHA = '0123456789abcdef0123456789abcdef01234567'

/** Читатель git, который ничего не может прочесть. */
const gitUnavailable = () => null

const original = process.env.VERCEL_GIT_COMMIT_SHA

afterEach(() => {
  if (original === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA
  else process.env.VERCEL_GIT_COMMIT_SHA = original
})

function headOfWorkingCopy(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
}

describe('resolveCommit', () => {
  it('возвращает коммит, названный хостом, а не коммит рабочей копии', () => {
    process.env.VERCEL_GIT_COMMIT_SHA = HOST_SHA

    expect(HOST_SHA).not.toBe(headOfWorkingCopy())
    expect(resolveCommit()).toBe(HOST_SHA)
  })

  it('без переменной хоста возвращает HEAD рабочей копии, спрашивая настоящий git', () => {
    delete process.env.VERCEL_GIT_COMMIT_SHA

    expect(resolveCommit()).toBe(headOfWorkingCopy())
  })

  it('без переменной хоста и без доступного git отвечает «неизвестно»', () => {
    delete process.env.VERCEL_GIT_COMMIT_SHA

    expect(resolveCommit(gitUnavailable)).toBe('неизвестно')
  })

  it('пустую переменную хоста ответом не считает: без git отвечает «неизвестно»', () => {
    process.env.VERCEL_GIT_COMMIT_SHA = ''

    expect(resolveCommit(gitUnavailable)).toBe('неизвестно')
  })

  it('пустую переменную хоста ответом не считает: при живом git берёт номер из git', () => {
    process.env.VERCEL_GIT_COMMIT_SHA = ''

    expect(resolveCommit()).toBe(headOfWorkingCopy())
  })

  it('известный номер коммита неизвестным не называет', () => {
    process.env.VERCEL_GIT_COMMIT_SHA = HOST_SHA

    expect(resolveCommit()).toBe(HOST_SHA)
    expect(resolveCommit()).not.toBe('неизвестно')
  })
})
