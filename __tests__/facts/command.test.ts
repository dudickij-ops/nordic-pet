import { spawnSync } from 'node:child_process'

import { Pool } from 'pg'
import { afterAll, describe, expect, it } from 'vitest'

import { projectDatabaseUrl } from '@/lib/db-url'

/**
 * Команду запускает простой `node`, а не vitest, и разрешает пути тоже он. Сокращение `@/`
 * понимают vitest и Next, но не он: команда, написанная с таким сокращением, проходит все
 * проверки и падает на первом же настоящем запуске. Поэтому команда проверяется тем же
 * способом, каким её запускают, — отдельным процессом.
 *
 * Файл отдельный, а не дописанный к проверкам команд S2 и S3: их наборы в этом куске не
 * правятся ни на строку, они служат признаком того, что поведение загрузок не изменилось.
 */
/**
 * Команда пишет в базу по-настоящему. Значит она же обязана вернуть базу такой, какой её
 * нашла: после посева слой фактов пуст, и на это опираются три проверки S1. Тот же приём,
 * что у живых проверок S2 и S3.
 */
const pool = new Pool({ connectionString: projectDatabaseUrl() })
afterAll(async () => {
  for (const table of ['orders', 'refunds', 'costs', 'fees', 'opex', 'fx', 'ads']) {
    await pool.query(`delete from fact.${table}`)
  }
  await pool.end()
})

function runCommand(env: Record<string, string>) {
  return spawnSync(process.execPath, ['scripts/build-facts.ts'], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
}

describe('команда разбора', () => {
  it('запускается простым node: все её части находятся', () => {
    // Среда не названа — команда обязана отказаться. Важно здесь другое: отказ приходит
    // от самой команды, а не от загрузчика модулей.
    const run = runCommand({ NORDIC_PET_DB_TARGET: '' })
    expect(run.stderr).not.toContain('ERR_MODULE_NOT_FOUND')
    expect(run.stderr).not.toContain('Cannot find package')
    expect(run.stderr).toContain('NORDIC_PET_DB_TARGET')
    expect(run.status).toBe(1)
  })

  it('не ходит в базу, пока среда не названа', () => {
    const run = runCommand({ NORDIC_PET_DB_TARGET: 'куда-нибудь' })
    expect(run.stderr).toContain('разбор отменён')
    expect(run.stdout).toBe('')
    expect(run.status).toBe(1)
  })

  it('на местной базе печатает цель первой строкой и весь отчёт', () => {
    const run = runCommand({ NORDIC_PET_DB_TARGET: 'local' })
    expect(run.status).toBe(0)

    const lines = run.stdout.split('\n')
    expect(lines[0]).toMatch(/^цель: local/)

    // Каждая часть отчёта называется вслух, в том числе когда называть нечего: молчание
    // не отличить от «не проверяли».
    expect(run.stdout).toContain('fact.orders')
    expect(run.stdout).toContain('близнецов')
    expect(run.stdout).toContain('свёрнуто копий')
    expect(run.stdout).toContain('площадки')
    expect(run.stdout).toMatch(/пустых денежных ячеек|пустых денежных/)
  })

  it('печатает ноль близнецов числом, а не пустым местом', () => {
    const run = runCommand({ NORDIC_PET_DB_TARGET: 'local' })
    expect(run.stdout).toMatch(/близнецов[^\n]*orders[^\n]*0|orders[^\n]*близнецов[^\n]*0|близнецов: 0/)
  })
})
