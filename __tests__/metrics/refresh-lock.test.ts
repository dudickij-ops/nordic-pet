import { Pool } from 'pg'
import { afterAll, beforeAll, expect, test, vi } from 'vitest'

import { projectDatabaseUrl } from '@/lib/db-url'
import { refreshEverything, замокВБазе, type Замок } from '@/lib/metrics/refresh'

/**
 * Замок на два одновременных обновления — задача 6 куска S8.
 *
 * Приёмка работодателя прямо велит нажать «Обновить» второй раз подряд, а нетерпеливый человек
 * нажмёт раньше, чем закончится первая загрузка. Прежде две загрузки шли в базу внахлёст, и
 * Postgres отвечал взаимной блокировкой — отказом, из которого человеку не понять ничего.
 */

const pool = new Pool({ connectionString: projectDatabaseUrl() })

let прежняяЦель: string | undefined
beforeAll(() => {
  прежняяЦель = process.env.NORDIC_PET_DB_TARGET
  process.env.NORDIC_PET_DB_TARGET = 'local'
})
afterAll(async () => {
  if (прежняяЦель === undefined) delete process.env.NORDIC_PET_DB_TARGET
  else process.env.NORDIC_PET_DB_TARGET = прежняяЦель
  await pool.end()
})

/** Три работы кнопки, каждая — соглядатай: доказывать надо, что их **не позвали**. */
function работы() {
  return {
    ingestSheets: vi.fn(async () => {}),
    ingestAds: vi.fn(async () => {}),
    buildFacts: vi.fn(async () => {}),
  }
}

const свободныйЗамок = async (): Promise<Замок> => ({ взят: true, отпустить: async () => {} })
const занятыйЗамок = async (): Promise<Замок> => ({ взят: false, отпустить: async () => {} })

/**
 * Главное утверждение задачи: наблюдается, что второй прогон **не дошёл до базы**, а не то, что
 * он чем-то ответил. Отказ, вернувшийся после того, как половина работы уже сделана, выглядел бы
 * точно так же.
 */
test('второй прогон внахлёст не позвал ни одной из трёх работ', async () => {
  const шаги = работы()

  const исход = await refreshEverything({ ...шаги, замок: занятыйЗамок })

  expect(шаги.ingestSheets).not.toHaveBeenCalled()
  expect(шаги.ingestAds).not.toHaveBeenCalled()
  expect(шаги.buildFacts).not.toHaveBeenCalled()
  expect(исход.ok).toBe(false)
  expect(исход.ok === false && 'занято' in исход ? исход.text : '').toMatch(/уже идёт/i)
})

test('свободный замок работам не мешает', async () => {
  const шаги = работы()

  const исход = await refreshEverything({ ...шаги, замок: свободныйЗамок })

  expect(исход).toEqual({ ok: true })
  expect(шаги.ingestSheets).toHaveBeenCalledTimes(1)
  expect(шаги.buildFacts).toHaveBeenCalledTimes(1)
})

/**
 * Отпускается в любом исходе. Иначе один отказ запер бы кнопку до перезапуска процесса —
 * дефект, который проявился бы у проверяющего и выглядел бы как «кнопка сломалась насовсем».
 */
test('замок отпускается и после отказа шага', async () => {
  const отпущен: string[] = []
  const замок = async (): Promise<Замок> => ({
    взят: true,
    отпустить: async () => {
      отпущен.push('да')
    },
  })

  const исход = await refreshEverything({
    ...работы(),
    ingestSheets: async () => {
      throw new Error('Таблица не открылась')
    },
    замок,
  })

  expect(исход.ok).toBe(false)
  expect(отпущен).toEqual(['да'])
})

/**
 * Настоящий замок на настоящей базе — строкой в таблице, а не совещательным замком.
 *
 * Совещательный замок сеансового уровня в бою не работает: боевой адрес идёт через объединитель
 * соединений в транзакционном режиме, где такие замки, по его же карте возможностей, «Never».
 * Здесь проверяется то, что вправду поедет в бой.
 */
test('настоящий замок второму не даётся и после отпускания даётся снова', async () => {
  const первый = await замокВБазе()
  expect(первый.взят).toBe(true)

  const второй = await замокВБазе()
  expect(второй.взят, 'второй обязан уйти ни с чем, а не ждать очереди').toBe(false)
  await второй.отпустить()

  await первый.отпустить()

  const третий = await замокВБазе()
  expect(третий.взят, 'после отпускания замок снова свободен').toBe(true)
  await третий.отпустить()
})

/**
 * Аренда — плата за то, что таблица сама не отпустится: процесс, убитый посреди обновления,
 * оставил бы кнопку запертой навсегда. Здесь проверяется, что брошенный замок вправду
 * освобождается, а не что мы это пообещали.
 */
test('протухшая аренда освобождает замок', async () => {
  const брошенный = await замокВБазе()
  expect(брошенный.взят).toBe(true)

  // Никто не отпускал — обновление «упало». Отматываем отметку за пределы аренды.
  await pool.query(
    "update meta.refresh_lock set taken_at = clock_timestamp() - interval '1 day'",
  )

  const следующий = await замокВБазе()
  expect(следующий.взят, 'брошенный замок отпускается по истечении аренды').toBe(true)
  await следующий.отпустить()
})

test('после отпускания строка замка свободна', async () => {
  const замок = await замокВБазе()
  await замок.отпустить()

  const { rows } = await pool.query<{ taken_at: Date | null }>(
    'select taken_at from meta.refresh_lock',
  )
  expect(rows[0]?.taken_at ?? null).toBeNull()
})
