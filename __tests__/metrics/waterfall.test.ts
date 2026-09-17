import { Pool } from 'pg'
import { afterAll, describe, expect, test } from 'vitest'

import { projectDatabaseUrl } from '@/lib/db-url'
import { monthlyReport } from '@/lib/metrics/report'
import { WATERFALL_FROM_TOTALS } from '@/lib/metrics/sql'

/**
 * Водопад — кусок S11, шаг 1; кусок S13, задача 1 — семь ступеней от чистой выручки с
 * маржинальным доходом, `largest` и ступени оборота/скидок/возвратов убраны.
 *
 * Ступени не считают денег сами: они раскладывают строку итогов месяца. Поэтому проверки ниже
 * подставляют **выдуманную строку итогов** и сличают ступени с ней — тем же приёмом, что у
 * проверок экрана S5: числа нарочно не сходятся между собой, и ступень, взявшая не свою колонку
 * или посчитавшая прибыль вторым выражением, напечатает число, которого в строке нет.
 *
 * Последняя проверка идёт настоящим путём — через `monthlyReport()` на местной базе, без
 * подставки: подставленная строка итогов не доказывает, что боевой запрос её получает.
 */

const pool = new Pool({ connectionString: projectDatabaseUrl() })
afterAll(() => pool.end())

type Итоги = {
  gross: string
  discounts: string
  refunds: string
  net: string
  cogs: string
  ads: string
  fees: string
  fixed: string
  profit: string
}

type Ступень = {
  key: string
  kind: string
  amount: string
  share_pct: string | null
  base_pct: string | null
  scale_low_pct: string | null
  scale_high_pct: string | null
  net_gap: string | null
  profit_gap: string | null
}

/**
 * Ступени водопада по подставленной строке итогов — тем же запросом, что в бою. Второй довод —
 * есть ли в месяце хоть одна строка рекламы: в бою его даёт `ЕСТЬ_РЕКЛАМА`, здесь он подставляется,
 * потому что раскладка итогов о строках рекламы ничего не знает.
 */
async function ступени(итоги: Итоги, естьРеклама = true): Promise<Ступень[]> {
  const колонки = Object.entries(итоги)
    .map(([имя, значение]) => `'${значение}'::text as ${имя}`)
    .join(', ')
  const { rows } = await pool.query(
    `with totals_row as (select ${колонки}),\n     cur_state as (select ${естьРеклама} as has_ads),\n${WATERFALL_FROM_TOTALS}`,
  )
  return rows as Ступень[]
}

function ступень(все: Ступень[], key: string): Ступень {
  const найдена = все.find((с) => с.key === key)
  if (найдена === undefined) throw new Error(`ступени ${key} в водопаде нет`)
  return найдена
}

/** Сходящаяся строка: 1000 − 100 − 50 = 850; 850 − 300 − 200 − 50 − 100 = 200. */
const СХОДЯЩИЕСЯ: Итоги = {
  gross: '1000.00',
  discounts: '100.00',
  refunds: '50.00',
  net: '850.00',
  cogs: '300.00',
  ads: '200.00',
  fees: '50.00',
  fixed: '100.00',
  profit: '200.00',
}

/** Строка, в которой ни одно число не выводится из соседей. */
const НЕСХОДЯЩИЕСЯ: Итоги = {
  gross: '1111.11',
  discounts: '22.22',
  refunds: '33.33',
  net: '444.44',
  cogs: '55.55',
  ads: '66.66',
  fees: '7.77',
  fixed: '88.88',
  profit: '9.99',
}

describe('водопад', () => {
  test('ступеней семь, от чистой выручки до прибыли, маржинальный доход пятым', async () => {
    expect((await ступени(СХОДЯЩИЕСЯ)).map((с) => с.key)).toEqual([
      'net', 'cogs', 'ads', 'fees', 'margin_income', 'fixed', 'profit',
    ])
  })

  test('доли и края ступеней — от чистой выручки', async () => {
    const все = await ступени(СХОДЯЩИЕСЯ)
    expect(ступень(все, 'net').share_pct).toBe('100.0')
    expect(ступень(все, 'cogs').share_pct).toBe('35.3')
    expect(ступень(все, 'cogs').base_pct).toBe('64.7')
    expect(ступень(все, 'ads').base_pct).toBe('41.2')
    expect(ступень(все, 'margin_income').share_pct).toBe('35.3')
    expect(ступень(все, 'fixed').base_pct).toBe('23.5')
    expect(ступень(все, 'profit').share_pct).toBe('23.5')
  })

  test('маржинальный доход — разность показанных сумм, а не своё выражение прибыли', async () => {
    const все = await ступени(НЕСХОДЯЩИЕСЯ)
    expect(ступень(все, 'margin_income').amount).toBe('314.46')
    expect(ступень(все, 'margin_income').kind).toBe('итог')
  })

  test('расхождения цепочки остаются у чистой выручки и у прибыли', async () => {
    const [первая] = await ступени(НЕСХОДЯЩИЕСЯ)
    expect(первая.net_gap).toBe('611.12')
    expect(первая.profit_gap).toBe('215.59')
  })

  test('чистая выручка не положительна — долей и краёв нет, суммы стоят', async () => {
    for (const net of ['0.00', '-10.00']) {
      const все = await ступени({ ...СХОДЯЩИЕСЯ, net })
      expect(все.every((с) => с.share_pct === null && с.base_pct === null)).toBe(true)
      expect(ступень(все, 'net').amount).toBe(net)
    }
  })

  // Кусок S13, задача 17, правка по итоговой проверке (М6): утверждение о шкале из прежней проверки «оборот ноль —
  // доли, края и шкала пусты, а не нули» (учёт задачи 1) вернулось — при новом условии пустоты.
  test('чистая выручка не положительна — пределов шкалы нет', async () => {
    for (const net of ['0.00', '-10.00']) {
      const все = await ступени({ ...СХОДЯЩИЕСЯ, net })
      expect(все.every((с) => с.scale_low_pct === null && с.scale_high_pct === null), net).toBe(true)
    }
  })

  test('без строк рекламы ступень рекламы пуста, маржинальный доход считается с нулём', async () => {
    const все = await ступени({ ...СХОДЯЩИЕСЯ, ads: '0.00' }, false)
    expect(ступень(все, 'ads').amount).toBeNull()
    expect(ступень(все, 'margin_income').amount).toBe('500.00')
  })

  test('три итога водопада — от нуля; отрицательная прибыль идёт вниз, и шкала опускается под ноль', async () => {
    const все = await ступени({ ...СХОДЯЩИЕСЯ, fixed: '400.00', profit: '-100.00' })
    expect(ступень(все, 'net').base_pct).toBe('0.0')
    expect(ступень(все, 'margin_income').base_pct).toBe('0.0')
    expect(ступень(все, 'profit').share_pct).toBe('-11.8')
    expect(ступень(все, 'profit').base_pct).toBe('-11.8')
    expect(new Set(все.map((с) => с.scale_low_pct))).toEqual(new Set(['-11.8']))
    expect(new Set(все.map((с) => с.scale_high_pct))).toEqual(new Set(['100.0']))
  })
})

/** Деньги строкой → целые центы. Счёт в проверке, а не на экране: проверка сличает, экран печатает. */
function центы(деньги: string): number {
  const [целые, дробь = ''] = деньги.replace('-', '').split('.')
  const знак = деньги.startsWith('-') ? -1 : 1
  return знак * (Number(целые) * 100 + Number(дробь.padEnd(2, '0')))
}

/** Центы → строка, как её печатает `numeric` Postgres; ноль — пусто, как отдаёт запрос. */
function деньгиИлиПусто(ц: number): string | null {
  if (ц === 0) return null
  const знак = ц < 0 ? '-' : ''
  const м = Math.abs(ц)
  return `${знак}${Math.floor(м / 100)}.${String(м % 100).padStart(2, '0')}`
}

describe('расхождение цепочки с итогом — решение Ж2', () => {
  test('напечатанное расхождение равно фактической разнице между суммой показанных ступеней и показанным итогом', async () => {
    const наборы: Итоги[] = [
      СХОДЯЩИЕСЯ,
      // Цент округления, как на марте: цепочка даёт 200,00, прибыль — 199,99.
      { ...СХОДЯЩИЕСЯ, profit: '199.99' },
      // Цент в первой цепочке: 1000 − 100 − 50 = 850,00, а чистая выручка — 850,01.
      { ...СХОДЯЩИЕСЯ, net: '850.01' },
      НЕСХОДЯЩИЕСЯ,
    ]
    for (const итоги of наборы) {
      const все = await ступени(итоги)
      // «Оборот», «скидки» и «возвраты» больше не ступени водопада (кусок S13) — их центы берутся
      // из самой подставленной строки итогов, а не из раскладки ступеней.
      const с = Object.fromEntries(все.map((ступ) => [ступ.key, центы(ступ.amount)]))
      const [строка] = все
      expect(строка.net_gap, `чистая выручка, ${JSON.stringify(итоги)}`).toBe(
        деньгиИлиПусто(центы(итоги.gross) - центы(итоги.discounts) - центы(итоги.refunds) - центы(итоги.net)),
      )
      expect(строка.profit_gap, `прибыль, ${JSON.stringify(итоги)}`).toBe(
        деньгиИлиПусто(с.net - с.cogs - с.ads - с.fees - с.fixed - с.profit),
      )
    }
  })
})

/**
 * Заказ, который кладётся только на время проверки настоящего пути. Посев не содержит ни одного
 * заказа, а сличение нуля с нулём зелено при любом коде — поэтому обе стороны обязаны быть числами.
 */
const МАРТ_ПРОВЕРКИ = { номер: 9711, день: '2026-03-11', заказ: 'T-9711' }

async function положитьМарт(): Promise<void> {
  await убратьМарт()
  await pool.query(
    `insert into raw.orders (row_no, date, order_id, sku, units, gross_eur, discount_eur, gateway)
     values ($1, $2, $3, 'NP-T', '1', '300.00', '0', 'card')`,
    [МАРТ_ПРОВЕРКИ.номер, МАРТ_ПРОВЕРКИ.день, МАРТ_ПРОВЕРКИ.заказ],
  )
  await pool.query(
    `insert into fact.orders (row_no, date, order_id, sku, units, gross, discount, currency, gateway)
     values ($1, $2::date, $3, 'NP-T', 1, 300.00, 0, 'EUR', 'card')`,
    [МАРТ_ПРОВЕРКИ.номер, МАРТ_ПРОВЕРКИ.день, МАРТ_ПРОВЕРКИ.заказ],
  )
}

/**
 * Уборка — устройством, а не аккуратностью: зовётся перед вставкой (след оборвавшегося прошлого
 * прогона лечится сам), в `finally` самой проверки и в `afterAll` файла.
 */
async function убратьМарт(): Promise<void> {
  await pool.query('delete from fact.orders where row_no = $1', [МАРТ_ПРОВЕРКИ.номер])
  await pool.query('delete from raw.orders where row_no = $1', [МАРТ_ПРОВЕРКИ.номер])
}

afterAll(убратьМарт)

describe('водопад в отчёте — настоящим путём', () => {
  test('отчёт несёт водопад из семи ступеней, прочитанный тем же снимком', async () => {
    // Круг проверки кода 3. Прежде сличение шло на посеве, где заказов нет: обе стороны были
    // «0.00», и перекрещённые колонки остались бы зелёными. Заказ кладётся на время проверки,
    // и у каждой стороны появляется якорь снаружи — она обязана быть не нулём.
    const прежняя = process.env.NORDIC_PET_DB_TARGET
    process.env.NORDIC_PET_DB_TARGET = 'local'
    try {
      await положитьМарт()
      const отчёт = await monthlyReport('2026-03')
      expect(отчёт.waterfall?.steps.map((с) => с.key)).toEqual([
        'net', 'cogs', 'ads', 'fees', 'margin_income', 'fixed', 'profit',
      ])
      expect(отчёт.revenue.net, 'заказ проверки доехал до чистой выручки').not.toBe('0.00')
      expect(отчёт.bottom.profit, 'прибыль не ноль, иначе сличать нечего').not.toBe('0.00')
      // Ступень прибыли обязана совпасть с прибылью итога того же отчёта, а ступень чистой
      // выручки — с чистой выручкой итога. У обеих пар стороны различны, и перекрёст краснеет.
      expect(отчёт.waterfall?.steps.find((с) => с.key === 'profit')?.amount).toBe(отчёт.bottom.profit)
      expect(отчёт.waterfall?.steps.find((с) => с.key === 'net')?.amount).toBe(отчёт.revenue.net)
      expect(отчёт.waterfall?.steps.find((с) => с.key === 'profit')?.amount).not.toBe(отчёт.revenue.net)
    } finally {
      await убратьМарт()
      if (прежняя === undefined) delete process.env.NORDIC_PET_DB_TARGET
      else process.env.NORDIC_PET_DB_TARGET = прежняя
    }
  })
})
