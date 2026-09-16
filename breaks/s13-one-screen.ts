import type { Break } from './types.ts'

/**
 * Список сломов куска S13 — один экран: сколько магазин заработал на самом деле.
 *
 * Набор проверок у каждого слома — весь `npm test`. Перепись экрана снимает весь видимый текст по
 * порядку, поэтому слом разметки красит и её — это объявляется у каждого такого слома.
 */

const ПЕРЕПИСЬ = 'перепись экрана: весь видимый текст, по порядку и без единой потери'
const ПЕРЕПИСЬ_ПРИЧИНА = 'перепись снимает весь видимый текст по порядку, а слом его меняет'

export const BREAKS: Break[] = [
  {
    id: 'waterfall-base-gross',
    claim: 'вернуть базу долей каскада к обороту',
    mustRedden: 'доли и края ступеней — от чистой выручки',
    file: 'lib/metrics/sql.ts',
    find: "select case when t.net::numeric > 0 then t.net::numeric end as denom,",
    replace: "select case when t.gross::numeric > 0 then t.gross::numeric end as denom,",
    alsoRedden: [
      { name: 'чистая выручка не положительна — долей и краёв нет, суммы стоят', why: 'при обороте больше нуля доли появляются и при нулевой чистой выручке' },
    ],
    tests: 'все',
  },
  {
    id: 'margin-income-own-expression',
    claim: 'посчитать маржинальный доход из прибыли и постоянных, а не разностью показанных сумм',
    mustRedden: 'маржинальный доход — разность показанных сумм',
    file: 'lib/metrics/sql.ts',
    find: '(5, \'margin_income\', \'итог\',      m.mi,             0::numeric,      m.mi),',
    replace: '(5, \'margin_income\', \'итог\',      t.profit::numeric + t.fixed::numeric, 0::numeric, m.mi),',
    tests: 'все',
  },
  {
    id: 'waterfall-share-says-gross',
    claim: 'назвать базу доли на экране оборотом',
    mustRedden: 'у каждой ступени названа база доли — чистая выручка',
    file: 'app/page.tsx',
    find: '`${percent(ступень.sharePct)} чистой выручки`',
    replace: '`${percent(ступень.sharePct)} оборота`',
    alsoRedden: [{ name: ПЕРЕПИСЬ, why: ПЕРЕПИСЬ_ПРИЧИНА }],
    tests: 'все',
  },
]
