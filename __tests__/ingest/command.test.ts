import { spawnSync } from 'node:child_process'

import { describe, expect, it } from 'vitest'

/**
 * Команду запускает простой `node`, а не vitest, и разрешает пути тоже он.
 * Сокращение `@/` понимают vitest и Next, но не он: загрузчик, написанный с таким
 * сокращением, проходит все проверки и падает на первом же настоящем запуске.
 * Поэтому команда проверяется тем же способом, каким её запускают, — отдельным процессом.
 */
function runCommand(env: Record<string, string>) {
  return spawnSync(process.execPath, ['scripts/ingest-sheets.ts'], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
}

describe('команда загрузки', () => {
  it('запускается простым node: все её части находятся', () => {
    // Среда не названа — команда обязана отказаться. Важно здесь другое: отказ приходит
    // от самой команды, а не от загрузчика модулей.
    const run = runCommand({ NORDIC_PET_DB_TARGET: '' })
    expect(run.stderr).not.toContain('ERR_MODULE_NOT_FOUND')
    expect(run.stderr).not.toContain('Cannot find package')
    expect(run.stderr).toContain('NORDIC_PET_DB_TARGET')
    expect(run.status).toBe(1)
  })

  it('не ходит ни в сеть, ни в базу, пока среда не названа', () => {
    const run = runCommand({ NORDIC_PET_DB_TARGET: 'куда-нибудь' })
    expect(run.stderr).toContain('загрузка отменена')
    expect(run.stdout).toBe('')
    expect(run.status).toBe(1)
  })
})
