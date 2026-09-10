import type { Break } from './types.ts'

/**
 * Список сломов куска S11 — содержание экрана: стало лучше или хуже.
 *
 * Список растёт по шагам нового порядка задач (план, раздел «Новый порядок задач»): каждый шаг
 * дописывает свои строки и заканчивается прогоном этих строк на полностью зелёном наборе.
 *
 * **Набор проверок у каждого слома — весь `npm test`, а не файл.** Узкий набор у сломов разметки
 * трёх прежних кусков — названная отложенная задача S10: слом, прогнанный по одному файлу, не
 * видит красного в соседних. Здесь лишнее красное обязано быть видно прибору.
 *
 * **Шаг 1 — водопад.** Ступени не считают денег сами: они раскладывают строку итогов месяца,
 * `MONTH_TOTALS` целиком. Сломы ниже бьют по раскладке — порядку, долям, краям, итогам от нуля —
 * и по тому, что отчёт вообще читает водопад.
 */

const ВОДОПАД_ПОРЯДОК = 'в водопаде ровно девять ступеней, в названном порядке'
const ВОДОПАД_КОЛОНКИ =
  'каждая ступень печатает свою колонку итогов, прибыль — та же колонка, что прибыль итога'
const ВОДОПАД_ПРОЦЕНТЫ = 'доли ступеней отданы процентами, а не долями единицы'
const ВОДОПАД_ОТ_ОБОРОТА = 'доли ступеней считаются от оборота, а не от чистой выручки'
const ВОДОПАД_СХОДИТСЯ = 'ступени водопада сходятся: вычитания висят от остатка и кончаются на итоге'
const ВОДОПАД_ИТОГИ_ОТ_НУЛЯ =
  'три итога водопада — от нуля; отрицательная прибыль идёт вниз, и шкала опускается под ноль'
const ВОДОПАД_ОБОРОТ_НОЛЬ = 'оборот ноль — доли, края и шкала пусты, а не нули'
const ВОДОПАД_В_ОТЧЁТЕ = 'отчёт несёт водопад из девяти ступеней, прочитанный тем же снимком'

const ДОЛЯ = 'round(s.amount / nullif(b.gross, 0) * 100, 1)::text'

const ВИД_ОДНО_ЗНАЧЕНИЕ = 'столбик ступени берёт ту же долю и тот же край, что напечатаны'
const ВИД_БАЗА = 'у каждой ступени названа база доли — оборот'
const ВИД_ПРИЗНАК = 'итог и вычитание различены признаком в разметке, а не только цветом'
const ВИД_ФОРМА = 'у итога водопада признак формы: полужирные подпись и сумма'
const ВИД_НОЛЬ = 'оборот ноль — у ступеней слова, столбиков нет'
const ВИД_ЯЧЕЙКИ = 'подписи ступеней водопада — отдельной ячейкой вне дорожки столбика'
const ПЕРЕПИСЬ = 'перепись экрана: весь видимый текст, по порядку и без единой потери'
const РАСХОЖДЕНИЕ =
  'напечатанное расхождение равно фактической разнице между суммой показанных ступеней и показанным итогом'
const РАСХОЖДЕНИЕ_СТРОКА = 'строка о расхождении — только когда оно есть, и с тем числом, что дал отчёт'
const ХВОСТ_ПРИБЫЛИ = '                  - t.fixed::numeric - t.profit::numeric, 0)'

export const BREAKS: Break[] = [
  {
    id: 'waterfall-chain-broken',
    claim: 'изменить одну ступень так, что остаток после вычитаний перестаёт сходиться с итогом',
    mustRedden: ВОДОПАД_СХОДИТСЯ,
    file: 'lib/metrics/sql.ts',
    find: '- t.fees::numeric),',
    replace: '),',
    tests: 'все',
  },
  {
    id: 'waterfall-fractions',
    claim: 'отдать доли ступеней долями единицы вместо процентов',
    mustRedden: ВОДОПАД_ПРОЦЕНТЫ,
    alsoRedden: [
      { name: ВОДОПАД_ОТ_ОБОРОТА, why: 'она сличает доли с процентами от оборота: 10,0 против 0,1' },
      { name: ВОДОПАД_СХОДИТСЯ, why: 'она сличает нижний край «постоянных» (проценты) с долей прибыли' },
      { name: ВОДОПАД_ИТОГИ_ОТ_НУЛЯ, why: 'она ждёт долю прибыли −10,0, а придёт −0,1' },
    ],
    file: 'lib/metrics/sql.ts',
    find: ДОЛЯ,
    replace: 'round(s.amount / nullif(b.gross, 0), 1)::text',
    tests: 'все',
  },
  {
    id: 'waterfall-share-of-net',
    claim: 'считать долю ступени от чистой выручки, а не от оборота',
    mustRedden: ВОДОПАД_ОТ_ОБОРОТА,
    alsoRedden: [
      { name: ВОДОПАД_СХОДИТСЯ, why: 'доля прибыли от чистой выручки перестаёт совпадать с краем, посчитанным от оборота' },
      { name: ВОДОПАД_ИТОГИ_ОТ_НУЛЯ, why: 'доля прибыли от чистой выручки — −11,8, а не −10,0' },
    ],
    file: 'lib/metrics/sql.ts',
    find: ДОЛЯ,
    replace: 'round(s.amount / nullif((select t.net::numeric from totals_row t), 0) * 100, 1)::text',
    tests: 'все',
  },
  {
    id: 'waterfall-step-dropped',
    claim: 'убрать ступень «чистая выручка» из набора',
    mustRedden: ВОДОПАД_ПОРЯДОК,
    alsoRedden: [
      { name: ВОДОПАД_КОЛОНКИ, why: 'она сличает все девять колонок, а ступеней становится восемь' },
      { name: ВОДОПАД_СХОДИТСЯ, why: 'она читает край и долю ступени «чистая выручка»' },
      { name: ВОДОПАД_ИТОГИ_ОТ_НУЛЯ, why: 'она читает край ступени «чистая выручка»' },
      { name: ВОДОПАД_В_ОТЧЁТЕ, why: 'она сличает порядок ступеней отчёта' },
    ],
    file: 'lib/metrics/sql.ts',
    find:
      "     (4, 'net',       'итог',      t.net::numeric,       0::numeric,\n" +
      '                                   t.net::numeric),\n',
    replace: '',
    tests: 'все',
  },
  {
    id: 'waterfall-second-profit',
    claim: 'завести прибыли ступени второе выражение из слагаемых вместо колонки прибыли итога',
    mustRedden: ВОДОПАД_КОЛОНКИ,
    file: 'lib/metrics/sql.ts',
    find: "(9, 'profit',    'итог',      t.profit::numeric,",
    replace:
      "(9, 'profit',    'итог',      t.net::numeric - t.cogs::numeric - t.ads::numeric - t.fees::numeric - t.fixed::numeric,",
    tests: 'все',
  },
  {
    id: 'waterfall-second-net',
    claim: 'посчитать промежуточный итог своим выражением вместо колонки чистой выручки итога',
    mustRedden: ВОДОПАД_КОЛОНКИ,
    file: 'lib/metrics/sql.ts',
    find: "(4, 'net',       'итог',      t.net::numeric,       0::numeric,",
    replace:
      "(4, 'net',       'итог',      t.gross::numeric - t.discounts::numeric - t.refunds::numeric,       0::numeric,",
    tests: 'все',
  },
  {
    id: 'waterfall-total-floats',
    claim: 'нарисовать промежуточный итог висящим от остатка, а не от нуля',
    mustRedden: ВОДОПАД_ИТОГИ_ОТ_НУЛЯ,
    alsoRedden: [{ name: ВОДОПАД_СХОДИТСЯ, why: 'она сличает края всех ступеней, край итога — ноль' }],
    file: 'lib/metrics/sql.ts',
    find: "(4, 'net',       'итог',      t.net::numeric,       0::numeric,",
    replace:
      "(4, 'net',       'итог',      t.net::numeric,       t.gross::numeric - t.discounts::numeric - t.refunds::numeric,",
    tests: 'все',
  },
  {
    id: 'waterfall-zero-share',
    claim: 'при нулевом обороте отдать долю ступени нулём, а не пустотой',
    mustRedden: ВОДОПАД_ОБОРОТ_НОЛЬ,
    file: 'lib/metrics/sql.ts',
    find: ДОЛЯ,
    replace: 'coalesce(round(s.amount / nullif(b.gross, 0) * 100, 1), 0)::text',
    tests: 'все',
  },
  {
    id: 'waterfall-not-in-report',
    claim: 'не прочитать водопад в отчёте',
    mustRedden: ВОДОПАД_В_ОТЧЁТЕ,
    file: 'lib/metrics/report.ts',
    find: '    const waterfallResult = await client.query(MONTH_WATERFALL, [dayParam])\n',
    replace: '    const waterfallResult = { rows: [] as Array<Record<string, unknown>> }\n',
    tests: 'все',
  },

  // Шаг 1, разметка и вид. Слома «блок рисуется и без своего поля» здесь нет, и это решение, а не
  // пропуск: такая разметка роняет отрисовку каждой принятой проверки, чья раскладка поля не несёт,
  // — два десятка проверок разом, и строка слома свелась бы к объявлению их всех «заодно».
  {
    id: 'waterfall-bar-other-value',
    claim: 'взять для длины столбика не ту долю, что напечатана текстом',
    mustRedden: ВИД_ОДНО_ЗНАЧЕНИЕ,
    file: 'app/page.tsx',
    find: "'--step-size': ступень.sharePct,",
    replace: "'--step-size': ступень.basePct,",
    tests: 'все',
  },
  {
    id: 'waterfall-base-unnamed',
    claim: 'печатать долю ступени без базы — без слова «оборота»',
    mustRedden: ВИД_БАЗА,
    alsoRedden: [
      { name: ВИД_ОДНО_ЗНАЧЕНИЕ, why: 'она ждёт текст доли вместе с базой: «37,5 % оборота»' },
      { name: ПЕРЕПИСЬ, why: 'в её списке у каждой ступени стоит «… % оборота»' },
    ],
    file: 'app/page.tsx',
    find: '`${percent(ступень.sharePct)} оборота`',
    replace: 'percent(ступень.sharePct)',
    tests: 'все',
  },
  {
    id: 'waterfall-kind-dropped',
    claim: 'снять со ступени признак итога или вычитания',
    mustRedden: ВИД_ПРИЗНАК,
    file: 'app/page.tsx',
    find: '<li key={ступень.key} data-kind={ступень.kind}>',
    replace: '<li key={ступень.key}>',
    tests: 'все',
  },
  {
    id: 'waterfall-total-weight-dropped',
    claim: 'снять у итога водопада полужирные подпись и сумму — оставить различие одним цветом',
    mustRedden: ВИД_ФОРМА,
    file: 'app/globals.css',
    find: '  font-weight: var(--fontWeightSemibold);\n}\n\n/*\n * Вычитание — светлая заливка',
    replace: '}\n\n/*\n * Вычитание — светлая заливка',
    tests: 'все',
  },
  {
    id: 'waterfall-zero-bar',
    claim: 'рисовать столбик ступени и тогда, когда доли нет',
    mustRedden: ВИД_НОЛЬ,
    file: 'app/page.tsx',
    find: '{ступень.sharePct !== null && ступень.basePct !== null && (',
    replace: '{(',
    tests: 'все',
  },
  {
    id: 'waterfall-label-in-track',
    claim: 'положить подпись ступени внутрь дорожки столбика',
    mustRedden: ВИД_ЯЧЕЙКИ,
    file: 'app/page.tsx',
    find:
      '                <span className="waterfall-label">\n' +
      '                  {ПОДПИСИ_СТУПЕНЕЙ[ступень.key] ?? ступень.key}\n' +
      '                </span>\n' +
      '                <span className="waterfall-track" aria-hidden="true">\n',
    replace:
      '                <span className="waterfall-track" aria-hidden="true">\n' +
      '                <span className="waterfall-label">\n' +
      '                  {ПОДПИСИ_СТУПЕНЕЙ[ступень.key] ?? ступень.key}\n' +
      '                </span>\n',
    tests: 'все',
  },

  // Шаг 1, расхождение цепочки с итогом — решение владельца по развилке Ж2. Утверждение без порога:
  // напечатанное число — ровно разница показанных сумм, и проверка считает её сама, в центах.
  {
    id: 'waterfall-gap-not-actual',
    claim: 'отдать расхождение с прибылью, не равное разнице показанных сумм — без одного слагаемого',
    mustRedden: РАСХОЖДЕНИЕ,
    file: 'lib/metrics/sql.ts',
    find: ХВОСТ_ПРИБЫЛИ,
    replace: '                  - t.profit::numeric, 0)',
    tests: 'все',
  },
  {
    id: 'waterfall-gap-zero-given',
    claim: 'отдать нулевое расхождение нулём, а не пустотой',
    mustRedden: РАСХОЖДЕНИЕ,
    file: 'lib/metrics/sql.ts',
    find: 'nullif(t.net::numeric - t.cogs::numeric - t.ads::numeric - t.fees::numeric',
    replace: '(t.net::numeric - t.cogs::numeric - t.ads::numeric - t.fees::numeric',
    andThen: { find: ХВОСТ_ПРИБЫЛИ, replace: '                  - t.fixed::numeric - t.profit::numeric)' },
    tests: 'все',
  },
  {
    id: 'waterfall-gap-line-without-gap',
    claim: 'печатать строку о расхождении и тогда, когда расхождения нет',
    mustRedden: РАСХОЖДЕНИЕ_СТРОКА,
    file: 'app/page.tsx',
    find: "{typeof report.waterfall.profitGap === 'string' && (",
    replace: '{report.waterfall.profitGap !== undefined && (',
    tests: 'все',
  },
]
