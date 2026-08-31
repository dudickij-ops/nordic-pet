import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'

import HealthPage from '@/app/health/page'

const HOST_SHA = '0123456789abcdef0123456789abcdef01234567'

/**
 * Путь к хранилищу git, которого не существует. Git, которому его указали,
 * ничего не найдёт и откажется отвечать — так изображается «git недоступен»,
 * не трогая ни рабочий каталог процесса, ни файловую систему.
 */
const NO_GIT_HERE = '/nordic-pet-такого-хранилища-git-нет'

const originalSha = process.env.VERCEL_GIT_COMMIT_SHA
const originalGitDir = process.env.GIT_DIR

afterEach(() => {
  for (const [name, value] of [
    ['VERCEL_GIT_COMMIT_SHA', originalSha],
    ['GIT_DIR', originalGitDir],
  ] as const) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

describe('страница /health', () => {
  it('печатает номер коммита, названный хостом', () => {
    process.env.VERCEL_GIT_COMMIT_SHA = HOST_SHA

    expect(renderToStaticMarkup(<HealthPage />)).toContain(HOST_SHA)
  })

  it('печатает «неизвестно», когда номер коммита взять неоткуда', () => {
    delete process.env.VERCEL_GIT_COMMIT_SHA
    process.env.GIT_DIR = NO_GIT_HERE

    expect(renderToStaticMarkup(<HealthPage />)).toContain('неизвестно')
  })
})
