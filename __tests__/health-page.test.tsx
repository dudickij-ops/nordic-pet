import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'

import HealthPage from '@/app/health/page'

const HOST_SHA = '0123456789abcdef0123456789abcdef01234567'

const originalSha = process.env.VERCEL_GIT_COMMIT_SHA
const originalCwd = process.cwd()

afterEach(() => {
  process.chdir(originalCwd)
  if (originalSha === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA
  else process.env.VERCEL_GIT_COMMIT_SHA = originalSha
})

describe('страница /health', () => {
  it('печатает номер коммита, названный хостом', () => {
    process.env.VERCEL_GIT_COMMIT_SHA = HOST_SHA

    expect(renderToStaticMarkup(<HealthPage />)).toContain(HOST_SHA)
  })

  it('печатает «неизвестно», когда номер коммита взять неоткуда', () => {
    delete process.env.VERCEL_GIT_COMMIT_SHA
    process.chdir(mkdtempSync(join(tmpdir(), 'nordic-pet-no-git-')))

    expect(renderToStaticMarkup(<HealthPage />)).toContain('неизвестно')
  })
})
