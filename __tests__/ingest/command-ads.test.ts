import { spawnSync } from 'node:child_process'

import { describe, expect, it } from 'vitest'

/**
 * Команду запускает простой `node`, а не vitest, и разрешает пути тоже он.
 * Сокращение `@/` понимают vitest и Next, но не он: команда, написанная с таким
 * сокращением, проходит все проверки и падает на первом же настоящем запуске.
 * Поэтому команда проверяется тем же способом, каким её запускают, — отдельным процессом.
 *
 * Файл отдельный, а не дописанный к проверке команды S2, нарочно: набор проверок S2 в
 * этом куске не правится ни на строку — он служит признаком того, что поведение старого
 * загрузчика не изменилось, и правка обесценила бы признак.
 */
function runCommand(env: Record<string, string>) {
  return spawnSync(process.execPath, ['scripts/ingest-ads.ts'], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
}

describe('команда загрузки рекламы', () => {
  it('запускается простым node: все её части находятся', () => {
    // Среда не названа — команда обязана отказаться. Важно здесь другое: отказ приходит
    // от самой команды, а не от загрузчика модулей.
    const run = runCommand({ NORDIC_PET_DB_TARGET: '' })
    expect(run.stderr).not.toContain('ERR_MODULE_NOT_FOUND')
    expect(run.stderr).not.toContain('Cannot find package')
    expect(run.stderr).toContain('NORDIC_PET_DB_TARGET')
    expect(run.status).toBe(1)
  })

  it('не ходит ни на Диск, ни в базу, пока среда не названа', () => {
    const run = runCommand({ NORDIC_PET_DB_TARGET: 'куда-нибудь' })
    expect(run.stderr).toContain('загрузка отменена')
    expect(run.stdout).toBe('')
    expect(run.status).toBe(1)
  })
})
