import { afterAll, describe, expect, test } from 'vitest'

import { inRollback, pool } from './support'

afterAll(() => pool.end())

/**
 * Запись слоя фактов: семь функций снимка, четыре деловых ключа и диапазон процента.
 *
 * Механизм идемпотентности в проекте один и тот же, что и у сырья: вставить новое, обновить
 * изменившееся с условием «содержимое стало другим», удалить адреса, которых в снимке нет.
 *
 * Деловые ключи объявлены **отложенными**: проверять их на промежуточном состоянии нельзя.
 * Внутри одной записи два курса могут обменяться датами, и в середине оператора состояние
 * законно нарушает уникальность, хотя в конце всё сходится. Отложенность проверяется здесь
 * же — оператором `set constraints all immediate`, который заставляет проверку случиться,
 * пока транзакция ещё жива.
 */

const json = (value: unknown[]) => JSON.stringify(value)

/** Сырая строка-опора: у факта есть внешний ключ на неё, без неё писать факт нечем. */
const RAW_FX = [
  { row_no: 501, date: '2026-03-01', usd_per_eur: '1.05' },
  { row_no: 502, date: '2026-03-02', usd_per_eur: '1.06' },
]

async function seedRawFx(client: { query: (sql: string, params?: unknown[]) => Promise<unknown> }) {
  for (const row of RAW_FX) {
    await client.query(`insert into raw.fx (row_no, date, usd_per_eur) values ($1, $2, $3)`, [
      row.row_no,
      row.date,
      row.usd_per_eur,
    ])
  }
}

describe('снимок фактов: вставка, обновление, подчистка', () => {
  test('тот же снимок дважды не меняет содержимого таблицы', async () => {
    await inRollback(async (client) => {
      await seedRawFx(client)
      const snapshot = json([
        { row_no: 501, date: '2026-03-01', usd_per_eur: '1.05' },
        { row_no: 502, date: '2026-03-02', usd_per_eur: '1.06' },
      ])

      await client.query('select fact.replace_fx($1::jsonb)', [snapshot])
      const { rows: first } = await client.query('select * from fact.fx order by row_no')
      await client.query('select fact.replace_fx($1::jsonb)', [snapshot])
      const { rows: second } = await client.query('select * from fact.fx order by row_no')

      // Сравнивается содержимое целиком, а не количество строк: удвоенная и переписанная
      // таблица дают одно и то же число строк.
      expect(second).toEqual(first)
    })
  })

  test('неизменившаяся строка не переписывается, а не просто «выглядит той же»', async () => {
    // Совпадения содержимого мало: безусловное обновление пишет те же значения, и таблица
    // снаружи выглядит нетронутой, хотя переписана целиком. Смотрим на ctid — физический
    // адрес версии строки: любая перезаписи кладёт новую версию по новому адресу, даже если
    // значения те же. Это тот же приём, которым S1 доказывает неподвижность сырья через
    // updated_at; у фактов такой колонки нет, и её роль играет системная.
    //
    // Не xmin: обе записи идут внутри одной транзакции проверки, а xmin — номер транзакции,
    // и у новой версии строки он остался бы тем же. Проверено сломом: с xmin снятие условия
    // «содержимое стало другим» не краснило ничего.
    await inRollback(async (client) => {
      await seedRawFx(client)
      const snapshot = json([
        { row_no: 501, date: '2026-03-01', usd_per_eur: '1.05' },
        { row_no: 502, date: '2026-03-02', usd_per_eur: '1.06' },
      ])

      await client.query('select fact.replace_fx($1::jsonb)', [snapshot])
      const { rows: before } = await client.query(
        'select row_no, ctid::text as version from fact.fx order by row_no',
      )
      await client.query('select fact.replace_fx($1::jsonb)', [snapshot])
      const { rows: after } = await client.query(
        'select row_no, ctid::text as version from fact.fx order by row_no',
      )

      expect(after).toEqual(before)
    })
  })

  test('изменившееся значение переписывается', async () => {
    await inRollback(async (client) => {
      await seedRawFx(client)
      await client.query('select fact.replace_fx($1::jsonb)', [
        json([{ row_no: 501, date: '2026-03-01', usd_per_eur: '1.05' }]),
      ])
      await client.query('select fact.replace_fx($1::jsonb)', [
        json([{ row_no: 501, date: '2026-03-01', usd_per_eur: '1.09' }]),
      ])

      const { rows } = await client.query('select usd_per_eur from fact.fx where row_no = 501')
      expect(rows[0].usd_per_eur).toBe('1.090000')
    })
  })

  test('адрес, которого в снимке больше нет, удаляется', async () => {
    await inRollback(async (client) => {
      await seedRawFx(client)
      await client.query('select fact.replace_fx($1::jsonb)', [
        json([
          { row_no: 501, date: '2026-03-01', usd_per_eur: '1.05' },
          { row_no: 502, date: '2026-03-02', usd_per_eur: '1.06' },
        ]),
      ])
      await client.query('select fact.replace_fx($1::jsonb)', [
        json([{ row_no: 501, date: '2026-03-01', usd_per_eur: '1.05' }]),
      ])

      const { rows } = await client.query('select row_no from fact.fx order by row_no')
      expect(rows.map((r) => r.row_no)).toEqual([501])
    })
  })

  test('деловые ключи могут обменяться между строками внутри одной записи', async () => {
    // Промежуточное состояние здесь законно нарушает уникальность: пока курс 501 ещё стоит
    // на первое марта, курс 502 уже на него переезжает. Проверка неотложенная порвала бы
    // законную правку источника — человек поменял местами две даты, и только.
    await inRollback(async (client) => {
      await seedRawFx(client)
      await client.query('select fact.replace_fx($1::jsonb)', [
        json([
          { row_no: 501, date: '2026-03-01', usd_per_eur: '1.05' },
          { row_no: 502, date: '2026-03-02', usd_per_eur: '1.06' },
        ]),
      ])

      await client.query('select fact.replace_fx($1::jsonb)', [
        json([
          { row_no: 501, date: '2026-03-02', usd_per_eur: '1.05' },
          { row_no: 502, date: '2026-03-01', usd_per_eur: '1.06' },
        ]),
      ])

      await client.query('set constraints all immediate')
      const { rows } = await client.query('select row_no, date from fact.fx order by row_no')
      expect(rows).toHaveLength(2)
    })
  })
})

describe('нулевой снимок', () => {
  test('пустое сырьё даёт пустые факты без отказа', async () => {
    await inRollback(async (client) => {
      await client.query('delete from raw.opex')
      await client.query('select fact.replace_opex($1::jsonb)', [json([])])

      const { rows } = await client.query('select count(*)::int as n from fact.opex')
      expect(rows[0].n).toBe(0)
    })
  })

  test('непустое сырьё при нуле фактов — отказ, называющий таблицу', async () => {
    // Так выглядел бы разбор, который прочитал сырьё и молча ничего не разобрал:
    // тихая потеря всех денег таблицы разом.
    await inRollback(async (client) => {
      const { rows } = await client.query('select count(*)::int as n from raw.opex')
      expect(rows[0].n).toBeGreaterThan(0)

      await expect(client.query('select fact.replace_opex($1::jsonb)', [json([])])).rejects.toThrow(
        /fact\.opex.*raw\.opex|raw\.opex.*fact\.opex/s,
      )
    })
  })

  test('отказ на нулевом снимке говорит человеку, что случилось', async () => {
    await inRollback(async (client) => {
      let message = ''
      try {
        await client.query('select fact.replace_orders($1::jsonb)', [json([])])
      } catch (error) {
        message = (error as Error).message
      }
      expect(message).toMatch(/ничего не разобра/i)
    })
  })

  test('факта без сырой строки не бывает и через функцию записи', async () => {
    await inRollback(async (client) => {
      await expect(
        client.query('select fact.replace_fx($1::jsonb)', [
          json([{ row_no: 777, date: '2026-03-01', usd_per_eur: '1.05' }]),
        ]),
      ).rejects.toThrow(/foreign key|внешн/i)
    })
  })
})

describe('деловые ключи', () => {
  test('два курса на одну дату — отказ', async () => {
    await inRollback(async (client) => {
      await seedRawFx(client)
      await client.query('select fact.replace_fx($1::jsonb)', [
        json([
          { row_no: 501, date: '2026-03-01', usd_per_eur: '1.05' },
          { row_no: 502, date: '2026-03-01', usd_per_eur: '1.09' },
        ]),
      ])

      await expect(client.query('set constraints all immediate')).rejects.toThrow(/fx_/)
    })
  })

  test('две пустые даты курса тоже считаются одним ключом', async () => {
    // Без `nulls not distinct` указатель считал бы две пустые даты разными и пропустил бы
    // ровно тот случай, ради которого стоит.
    await inRollback(async (client) => {
      await seedRawFx(client)
      await client.query('select fact.replace_fx($1::jsonb)', [
        json([
          { row_no: 501, date: null, usd_per_eur: '1.05' },
          { row_no: 502, date: null, usd_per_eur: '1.09' },
        ]),
      ])

      await expect(client.query('set constraints all immediate')).rejects.toThrow(/fx_/)
    })
  })

  test('две цены на один артикул и одну дату начала — отказ', async () => {
    await inRollback(async (client) => {
      await client.query(`insert into raw.costs (row_no) values (501), (502)`)
      await client.query('select fact.replace_costs($1::jsonb)', [
        json([
          { row_no: 501, sku: 'NP-004', cost: '16.50', currency: 'EUR', valid_from: '2026-01-01' },
          { row_no: 502, sku: 'NP-004', cost: '21.90', currency: 'EUR', valid_from: '2026-01-01' },
        ]),
      ])

      await expect(client.query('set constraints all immediate')).rejects.toThrow(/costs_/)
    })
  })

  test('две цены на один артикул с разными датами начала — законно', async () => {
    await inRollback(async (client) => {
      await client.query(`insert into raw.costs (row_no) values (501), (502)`)
      await client.query('select fact.replace_costs($1::jsonb)', [
        json([
          { row_no: 501, sku: 'NP-004', cost: '16.50', currency: 'EUR', valid_from: '2026-01-01' },
          { row_no: 502, sku: 'NP-004', cost: '21.90', currency: 'EUR', valid_from: '2026-03-15' },
        ]),
      ])

      await client.query('set constraints all immediate')
      const { rows } = await client.query('select count(*)::int as n from fact.costs')
      expect(rows[0].n).toBe(2)
    })
  })

  test('две ставки на один способ оплаты — отказ', async () => {
    await inRollback(async (client) => {
      await client.query(`insert into raw.fees (row_no) values (501), (502)`)
      await client.query('select fact.replace_fees($1::jsonb)', [
        json([
          { row_no: 501, gateway: 'card', percent: '1.9', fixed: '0.25', currency: 'EUR' },
          { row_no: 502, gateway: 'card', percent: '2.9', fixed: '0.25', currency: 'EUR' },
        ]),
      ])

      await expect(client.query('set constraints all immediate')).rejects.toThrow(/fees_/)
    })
  })

  test('две строки рекламы на площадку, день и кампанию — отказ', async () => {
    await inRollback(async (client) => {
      await client.query(
        `insert into raw.ads (file_name, row_no) values ('meta_a.csv', 501), ('meta_b.csv', 501)`,
      )
      await client.query('select fact.replace_ads($1::jsonb)', [
        json([
          {
            file_name: 'meta_a.csv', row_no: 501, date: '2026-03-01', campaign: 'Broad EU',
            platform: 'meta', spend: '12.40', currency: 'USD',
          },
          {
            file_name: 'meta_b.csv', row_no: 501, date: '2026-03-01', campaign: 'Broad EU',
            platform: 'meta', spend: '9.80', currency: 'USD',
          },
        ]),
      ])

      await expect(client.query('set constraints all immediate')).rejects.toThrow(/ads_/)
    })
  })

  test('те же дата и кампания у разных площадок — законно', async () => {
    await inRollback(async (client) => {
      await client.query(
        `insert into raw.ads (file_name, row_no) values ('meta_a.csv', 501), ('google_a.csv', 501)`,
      )
      await client.query('select fact.replace_ads($1::jsonb)', [
        json([
          {
            file_name: 'meta_a.csv', row_no: 501, date: '2026-03-01', campaign: 'Broad EU',
            platform: 'meta', spend: '12.40', currency: 'USD',
          },
          {
            file_name: 'google_a.csv', row_no: 501, date: '2026-03-01', campaign: 'Broad EU',
            platform: 'google', spend: '9.80', currency: 'USD',
          },
        ]),
      ])

      await client.query('set constraints all immediate')
      const { rows } = await client.query('select count(*)::int as n from fact.ads')
      expect(rows[0].n).toBe(2)
    })
  })
})

describe('процент комиссии хранится пунктами', () => {
  test.each(['0', '-1'])('нулевая и отрицательная ставка — наш отказ: %s', async (percent) => {
    // Проверяется имя нашего ограничения, а не любое красное: нулевая ставка молча обнулила
    // бы комиссию по всем заказам этого способа оплаты, и правило 7 выглядело бы исполненным.
    await inRollback(async (client) => {
      await client.query(`insert into raw.fees (row_no) values (501)`)
      await expect(
        client.query('select fact.replace_fees($1::jsonb)', [
          json([{ row_no: 501, gateway: 'card', percent, fixed: '0.25', currency: 'EUR' }]),
        ]),
      ).rejects.toThrow(/fees_percent_is_points/)
    })
  })

  test.each(['120', '100.01'])('ставка больше ста упирается в тип колонки: %s', async (percent) => {
    // Отказ здесь чужой — его даёт numeric(6,4), а не наше ограничение. Написано отдельной
    // проверкой нарочно: условие «не больше ста» в ограничении недостижимо, и стоять там оно
    // не должно — недостижимое условие создаёт видимость замка, которого нет.
    await inRollback(async (client) => {
      await client.query(`insert into raw.fees (row_no) values (501)`)
      await expect(
        client.query('select fact.replace_fees($1::jsonb)', [
          json([{ row_no: 501, gateway: 'card', percent, fixed: '0.25', currency: 'EUR' }]),
        ]),
      ).rejects.toThrow(/overflow|переполнени/i)
    })
  })

  test('доля вместо пунктов проходит: дыра названа, а не закрыта', async () => {
    // 0.0190 — это либо доля, записанная вместо 1.9 пункта, либо законная ставка в сотую
    // долю процента. Отличить одно от другого базе нечем, а порога, ниже которого ставок не
    // бывает, нет ни в задании, ни в документации; выдумывать его мы не станем. Проверка
    // стоит здесь, чтобы утверждение «ограничение ловит долю» никто не принял за правду:
    // если дыру однажды закроют, эта проверка покраснеет и потребует переписать и её, и
    // раздел «названо вслух» в контракте.
    await inRollback(async (client) => {
      await client.query(`insert into raw.fees (row_no) values (501)`)
      await client.query('select fact.replace_fees($1::jsonb)', [
        json([{ row_no: 501, gateway: 'card', percent: '0.0190', fixed: '0.25', currency: 'EUR' }]),
      ])
      const { rows } = await client.query('select percent from fact.fees where row_no = 501')
      expect(rows[0].percent).toBe('0.0190')
    })
  })

  test('пункты источника и пустое значение принимаются', async () => {
    await inRollback(async (client) => {
      await client.query(`insert into raw.fees (row_no) values (501), (502)`)
      await client.query('select fact.replace_fees($1::jsonb)', [
        json([
          { row_no: 501, gateway: 'card', percent: '1.9', fixed: '0.25', currency: 'EUR' },
          { row_no: 502, gateway: 'paypal', percent: null, fixed: '0.35', currency: 'EUR' },
        ]),
      ])

      const { rows } = await client.query('select count(*)::int as n from fact.fees')
      expect(rows[0].n).toBe(2)
    })
  })
})

describe('все семь таблиц пишутся своей функцией', () => {
  test('функции записи заведены на каждую таблицу фактов', async () => {
    const { rows } = await pool.query(
      `select p.proname from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'fact' and p.proname like 'replace_%'
        order by p.proname`,
    )
    expect(rows.map((r) => r.proname)).toEqual([
      'replace_ads',
      'replace_costs',
      'replace_fees',
      'replace_fx',
      'replace_opex',
      'replace_orders',
      'replace_refunds',
    ])
  })
})
