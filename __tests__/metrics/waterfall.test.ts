import { Pool } from 'pg'
import { afterAll, describe, expect, test } from 'vitest'

import { projectDatabaseUrl } from '@/lib/db-url'
import { monthlyReport } from '@/lib/metrics/report'
import { WATERFALL_FROM_TOTALS } from '@/lib/metrics/sql'

/**
 * Водопад — кусок S11, шаг 1.
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
}

/** Ступени водопада по подставленной строке итогов — тем же запросом, что в бою. */
async function ступени(итоги: Итоги): Promise<Ступень[]> {
  const колонки = Object.entries(итоги)
    .map(([имя, значение]) => `'${значение}'::text as ${имя}`)
    .join(', ')
  const { rows } = await pool.query(`with totals_row as (select ${колонки}),\n${WATERFALL_FROM_TOTALS}`)
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
  test('в водопаде ровно девять ступеней, в названном порядке', async () => {
    const все = await ступени(СХОДЯЩИЕСЯ)
    expect(все.map((с) => с.key)).toEqual([
      'gross', 'discounts', 'refunds', 'net', 'cogs', 'ads', 'fees', 'fixed', 'profit',
    ])
    expect(все.map((с) => с.kind)).toEqual([
      'итог', 'вычитание', 'вычитание', 'итог', 'вычитание', 'вычитание', 'вычитание', 'вычитание', 'итог',
    ])
  })

  test('каждая ступень печатает свою колонку итогов, прибыль — та же колонка, что прибыль итога', async () => {
    const все = await ступени(НЕСХОДЯЩИЕСЯ)
    // Прибыль 9,99 не равна ни одной разности слагаемых: второе выражение прибыли дало бы
    // 444,44 − 55,55 − 66,66 − 7,77 − 88,88 = 225,58.
    expect(Object.fromEntries(все.map((с) => [с.key, с.amount]))).toEqual(НЕСХОДЯЩИЕСЯ)
  })

  test('доли ступеней отданы процентами, а не долями единицы', async () => {
    // Оборот равен чистой выручке: база доли здесь не влияет на ответ, влияет только масштаб.
    const все = await ступени({ ...СХОДЯЩИЕСЯ, discounts: '0.00', refunds: '0.00', net: '1000.00' })
    expect(ступень(все, 'cogs').share_pct).toBe('30.0')
    expect(ступень(все, 'gross').share_pct).toBe('100.0')
  })

  test('доли ступеней считаются от оборота, а не от чистой выручки', async () => {
    const все = await ступени(СХОДЯЩИЕСЯ)
    // От оборота 100 / 1000 = 10,0 %; от чистой выручки было бы 100 / 850 = 11,8 %.
    expect(ступень(все, 'discounts').share_pct).toBe('10.0')
    expect(ступень(все, 'cogs').share_pct).toBe('30.0')
  })

  test('ступени водопада сходятся: вычитания висят от остатка и кончаются на итоге', async () => {
    const все = await ступени(СХОДЯЩИЕСЯ)
    const края = Object.fromEntries(все.map((с) => [с.key, с.base_pct]))
    expect(края).toEqual({
      gross: '0.0',
      discounts: '90.0',
      refunds: '85.0',
      net: '0.0',
      cogs: '55.0',
      ads: '35.0',
      fees: '30.0',
      fixed: '20.0',
      profit: '0.0',
    })
    // Нижний край последнего вычитания — это прибыль, нижний край «возвратов» — чистая выручка.
    expect(ступень(все, 'fixed').base_pct).toBe(ступень(все, 'profit').share_pct)
    expect(ступень(все, 'refunds').base_pct).toBe(ступень(все, 'net').share_pct)
  })

  test('три итога водопада — от нуля; отрицательная прибыль идёт вниз, и шкала опускается под ноль', async () => {
    const все = await ступени({ ...СХОДЯЩИЕСЯ, fixed: '400.00', profit: '-100.00' })
    expect(ступень(все, 'gross').base_pct).toBe('0.0')
    expect(ступень(все, 'net').base_pct).toBe('0.0')
    expect(ступень(все, 'profit').share_pct).toBe('-10.0')
    expect(ступень(все, 'profit').base_pct).toBe('-10.0')
    expect(new Set(все.map((с) => с.scale_low_pct))).toEqual(new Set(['-10.0']))
    expect(new Set(все.map((с) => с.scale_high_pct))).toEqual(new Set(['100.0']))
  })

  test('оборот ноль — доли, края и шкала пусты, а не нули', async () => {
    const нули: Итоги = {
      gross: '0.00', discounts: '0.00', refunds: '0.00', net: '0.00', cogs: '0.00',
      ads: '12.00', fees: '0.00', fixed: '30.00', profit: '-42.00',
    }
    const все = await ступени(нули)
    for (const с of все) {
      expect(с.share_pct, с.key).toBeNull()
      expect(с.base_pct, с.key).toBeNull()
      expect(с.scale_low_pct, с.key).toBeNull()
      expect(с.scale_high_pct, с.key).toBeNull()
    }
    expect(ступень(все, 'profit').amount).toBe('-42.00')
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
      const с = Object.fromEntries(все.map((ступ) => [ступ.key, центы(ступ.amount)]))
      const строка = все[0] as Ступень & { net_gap: string | null; profit_gap: string | null }
      expect(строка.net_gap, `чистая выручка, ${JSON.stringify(итоги)}`).toBe(
        деньгиИлиПусто(с.gross - с.discounts - с.refunds - с.net),
      )
      expect(строка.profit_gap, `прибыль, ${JSON.stringify(итоги)}`).toBe(
        деньгиИлиПусто(с.net - с.cogs - с.ads - с.fees - с.fixed - с.profit),
      )
    }
  })
})

describe('водопад в отчёте — настоящим путём', () => {
  test('отчёт несёт водопад из девяти ступеней, прочитанный тем же снимком', async () => {
    const прежняя = process.env.NORDIC_PET_DB_TARGET
    process.env.NORDIC_PET_DB_TARGET = 'local'
    try {
      const отчёт = await monthlyReport('2026-03')
      expect(отчёт.waterfall?.steps.map((с) => с.key)).toEqual([
        'gross', 'discounts', 'refunds', 'net', 'cogs', 'ads', 'fees', 'fixed', 'profit',
      ])
      // Какие бы факты ни лежали в местной базе, ступень прибыли обязана совпасть с прибылью
      // итога того же отчёта, а ступень оборота — с оборотом.
      expect(отчёт.waterfall?.steps.find((с) => с.key === 'profit')?.amount).toBe(отчёт.bottom.profit)
      expect(отчёт.waterfall?.steps.find((с) => с.key === 'gross')?.amount).toBe(отчёт.revenue.gross)
    } finally {
      if (прежняя === undefined) delete process.env.NORDIC_PET_DB_TARGET
      else process.env.NORDIC_PET_DB_TARGET = прежняя
    }
  })
})
