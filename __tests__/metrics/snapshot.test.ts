import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { withFactSnapshot } from '@/lib/metrics/report'

/**
 * Среда называется словом, и `withFactSnapshot` называет цель до всякого соединения —
 * тем же приёмом, что сборка фактов и загрузчики (см. `__tests__/facts/build.test.ts`).
 * Подставленное в проверках ниже соединение эту цель не читает, но резолвится она всё
 * равно: обязательство «цель называется до работы» не знает исключения для тестового
 * соединения. Среда возвращается на место после набора, как и в соседних наборах.
 */
let savedTarget: string | undefined
beforeAll(() => {
  savedTarget = process.env.NORDIC_PET_DB_TARGET
  process.env.NORDIC_PET_DB_TARGET = 'local'
})
afterAll(() => {
  if (savedTarget === undefined) delete process.env.NORDIC_PET_DB_TARGET
  else process.env.NORDIC_PET_DB_TARGET = savedTarget
})

describe('снимок фактов', () => {
  test('открывается на повторяемом чтении и только на чтение', async () => {
    const sent: string[] = []
    await withFactSnapshot(async () => 'готово', {
      announce: () => {},
      connect: async () => ({
        query: async (sql: string) => {
          sent.push(sql.trim().toLowerCase())
          return { rows: [] }
        },
        release: async () => {},
      }),
    })
    expect(sent[0]).toBe('begin isolation level repeatable read read only')
  })

  test('цель названа до первого запроса', async () => {
    const events: string[] = []
    await withFactSnapshot(async () => 'готово', {
      announce: (line) => events.push(`цель: ${line}`),
      connect: async () => {
        events.push('соединение')
        return { query: async () => ({ rows: [] }), release: async () => {} }
      },
    })
    expect(events[0]).toMatch(/^цель: /)
    expect(events).toContain('соединение')
    expect(events.indexOf('соединение')).toBeGreaterThan(0)
  })

  test('именованный запрос — отказ нашими словами', async () => {
    await expect(
      withFactSnapshot(
        async (client) =>
          (client.query as unknown as (q: unknown) => Promise<unknown>)({
            name: 'totals',
            text: 'select 1',
          }),
        {
          announce: () => {},
          connect: async () => ({ query: async () => ({ rows: [] }), release: async () => {} }),
        },
      ),
    ).rejects.toThrow(/именованный запрос/)
  })

  test('соединение отпускается даже когда работа отказала', async () => {
    let released = false
    await expect(
      withFactSnapshot(async () => { throw new Error('нарочно') }, {
        announce: () => {},
        connect: async () => ({
          query: async () => ({ rows: [] }),
          release: async () => { released = true },
        }),
      }),
    ).rejects.toThrow('нарочно')
    expect(released).toBe(true)
  })

  test('на настоящей базе без единого довода: запись внутри снимка невозможна', async () => {
    process.env.NORDIC_PET_DB_TARGET = 'local'
    const code = await withFactSnapshot(async (client) => {
      try {
        await client.query('create temporary table проба (x int)')
        return 'записалось'
      } catch (error) {
        return (error as { code?: string }).code ?? 'без кода'
      }
    })
    expect(code).toBe('25006')
  })
})
