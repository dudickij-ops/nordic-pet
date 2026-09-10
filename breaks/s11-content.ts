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
const СЪЕДАЕТ_СРЕДИ = 'самое большое вычитание помечено среди вычитаний, итоги не помечаются'
const СЪЕДАЕТ_РАВЕНСТВО = 'при равенстве двух вычитаний до цента помечены оба'
const СЪЕДАЕТ_НОЛЬ = 'все вычитания ноль — не помечено ничего'
const СЪЕДАЕТ_ДОЛЯ = 'строка «съедает больше всего» называет помеченную ступень и берёт её же долю'
const СЪЕДАЕТ_ПОРОВНУ = 'при равенстве строка называет обе ступени поровну'
const СЪЕДАЕТ_БЕЗ_ДОЛИ = 'без доли строки «съедает больше всего» нет'
const СЪЕДАЕТ_ЦВЕТ = 'у строки «съедает больше всего» нет своего цвета — это подпись, а не тревога'
const ПРИЗНАК = "(s.kind = 'вычитание'\n        and s.amount > 0\n        and s.amount = max(s.amount) filter (where s.kind = 'вычитание') over ())"

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
      { name: РАСХОЖДЕНИЕ, why: 'она сличает расхождение из строки итогов с разницей сумм, которые показали ступени; ступень не из своей колонки ломает это равенство' },
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
    alsoRedden: [
      { name: РАСХОЖДЕНИЕ, why: 'она сличает расхождение из строки итогов с разницей сумм, которые показали ступени; ступень не из своей колонки ломает это равенство' },
    ],
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
    alsoRedden: [
      { name: РАСХОЖДЕНИЕ, why: 'она сличает расхождение из строки итогов с разницей сумм, которые показали ступени; ступень не из своей колонки ломает это равенство' },
    ],
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
    alsoRedden: [
      { name: 'экран содержит кнопку и оборачивает ею отчёт', why: 'она рисует настоящую страницу на местной базе; у посева расхождения нет, и строка с пустым числом роняет отрисовку' },
    ],
    file: 'app/page.tsx',
    find: "{typeof report.waterfall.profitGap === 'string' && (",
    replace: '{report.waterfall.profitGap !== undefined && (',
    tests: 'все',
  },

  // Шаг 1, строка «съедает больше всего» — решение владельца. Признак ставит запрос водопада; при
  // равенстве до цента помечены все равные, и строка называет их поровну.
  {
    id: 'largest-among-all',
    claim: 'искать самое большое среди всех ступеней, а не среди вычитаний',
    mustRedden: СЪЕДАЕТ_СРЕДИ,
    alsoRedden: [
      { name: СЪЕДАЕТ_РАВЕНСТВО, why: 'оборот больше любого вычитания и оказывается помеченным и там' },
      { name: СЪЕДАЕТ_НОЛЬ, why: 'оборот 500 помечается, хотя вычитания все ноль' },
    ],
    file: 'lib/metrics/sql.ts',
    find: ПРИЗНАК,
    replace: '(s.amount > 0\n        and s.amount = max(s.amount) over ())',
    tests: 'все',
  },
  {
    id: 'largest-tie-first-only',
    claim: 'при равенстве двух вычитаний до цента пометить только первое по порядку',
    mustRedden: СЪЕДАЕТ_РАВЕНСТВО,
    file: 'lib/metrics/sql.ts',
    find: "and s.amount = max(s.amount) filter (where s.kind = 'вычитание') over ())",
    replace:
      "and s.ord = first_value(s.ord) over (order by (s.kind = 'вычитание') desc, s.amount desc, s.ord))",
    tests: 'все',
  },
  {
    id: 'largest-zero-marked',
    claim: 'пометить самым большим нулевое вычитание, когда все вычитания ноль',
    mustRedden: СЪЕДАЕТ_НОЛЬ,
    file: 'lib/metrics/sql.ts',
    find: '        and s.amount > 0\n',
    replace: '',
    tests: 'все',
  },
  {
    id: 'largest-share-other-step',
    claim: 'назвать в строке одну ступень, а долю взять у другой',
    mustRedden: СЪЕДАЕТ_ДОЛЯ,
    alsoRedden: [{ name: ПЕРЕПИСЬ, why: 'в её списке строка несёт долю помеченной ступени, 18,8 %' }],
    file: 'app/page.tsx',
    find: '· ${percent(съедает[0].sharePct)} оборота`',
    replace: '· ${percent(report.waterfall?.steps[0]?.sharePct ?? null)} оборота`',
    tests: 'все',
  },
  {
    id: 'largest-tie-one-name',
    claim: 'при равенстве назвать в строке только одну ступень',
    mustRedden: СЪЕДАЕТ_ПОРОВНУ,
    file: 'app/page.tsx',
    find: "${съедает.map(подписьСтроки).join(' и ')}",
    replace: '${подписьСтроки(съедает[0])}',
    tests: 'все',
  },
  {
    id: 'largest-without-share',
    claim: 'печатать строку «съедает больше всего» и тогда, когда доли нет',
    mustRedden: СЪЕДАЕТ_БЕЗ_ДОЛИ,
    alsoRedden: [
      { name: ВИД_НОЛЬ, why: 'в её раскладке ступень без доли помечена самой большой, и строка с «нет данных оборота» кладёт слово «оборота» на страницу' },
    ],
    file: 'app/page.tsx',
    find: 'с.largest === true && с.sharePct !== null',
    replace: 'с.largest === true',
    tests: 'все',
  },
  {
    id: 'largest-signal-colour',
    claim: 'покрасить строку «съедает больше всего» сигнальным цветом',
    mustRedden: СЪЕДАЕТ_ЦВЕТ,
    file: 'app/globals.css',
    find: '.waterfall-largest {\n  margin: 0 0 var(--spacingVerticalS);\n}',
    replace: '.waterfall-largest {\n  margin: 0 0 var(--spacingVerticalS);\n  color: var(--colorPaletteRedForeground1);\n}',
    tests: 'все',
  },

  // Шаг 2 — чистая выручка по дням (задача Д-7). Ряд группирует готовую цепочку money по дню заказа;
  // своих выражений денег у него нет. Якорь снаружи — живая проверка: сумма ряда марта 17 277,04 €.
  {
    id: 'daily-own-expression',
    claim: 'посчитать выручку дня своим выражением вместо цепочки money',
    mustRedden: 'сумма ряда по дням — чистая выручка месяца, из той же цепочки money',
    alsoRedden: [
      { name: 'доля дня — от наибольшей по модулю выручки дня, процентами со знаком', why: 'у её строк выручка задана при нулевом обороте; своё выражение даёт нули, и доли меняются' },
    ],
    file: 'lib/metrics/sql.ts',
    find: '  select m.sold_on as day, sum(m.net) as net\n',
    replace: '  select m.sold_on as day, sum(m.gross - m.discount - m.refund_amount) as net\n',
    tests: 'все',
  },
  {
    id: 'daily-empty-day-zero',
    claim: 'отдать день без заказов нулём, а не пустотой',
    mustRedden: 'день без заказов — пусто, а не ноль',
    file: 'lib/metrics/sql.ts',
    find: '       bd.net::text                                                              as net,',
    replace: '       coalesce(bd.net, 0)::text                                                 as net,',
    tests: 'все',
  },
  {
    id: 'daily-empty-day-dropped',
    claim: 'выбросить день без заказов из ряда',
    mustRedden: 'в ряду все дни месяца, по порядку',
    alsoRedden: [
      { name: 'день без заказов — пусто, а не ноль', why: 'первого марта в ряду больше нет' },
      { name: 'подпись дня приходит готовой строкой', why: 'у месяца без заказов ряд становится пустым, и первой подписи нет' },
      { name: 'отчёт несёт ряд из всех дней месяца, прочитанный тем же снимком', why: 'на посеве заказов нет, и ряд отчёта пуст' },
    ],
    file: 'lib/metrics/sql.ts',
    find: '  from days d\n  left join by_day bd on bd.day = d.day\n',
    replace: '  from days d\n  join by_day bd on bd.day = d.day\n',
    tests: 'все',
  },
  {
    id: 'daily-no-nullif',
    claim: 'снять nullif у делителя доли дня',
    mustRedden: 'наибольшая выручка дня ноль — доли пусты, а выручка дня — честный ноль',
    alsoRedden: [
      { name: 'нулевая чистая выручка от реальных строк не роняет отчёт ошибкой деления', why: 'принятая проверка S5: на её раскладке у дня нулевая выручка, и деление на ноль в ряду роняет весь отчёт — ровно то, от чего она сторожит' },
    ],
    file: 'lib/metrics/sql.ts',
    find: 'nullif(max(abs(net)), 0) as top',
    replace: 'max(abs(net)) as top',
    tests: 'все',
  },
  {
    id: 'daily-share-of-signed-max',
    claim: 'делить выручку дня на наибольшую выручку, а не на наибольшую по модулю',
    mustRedden: 'доля дня — от наибольшей по модулю выручки дня, процентами со знаком',
    file: 'lib/metrics/sql.ts',
    find: 'nullif(max(abs(net)), 0) as top',
    replace: 'nullif(max(net), 0) as top',
    tests: 'все',
  },
  {
    id: 'daily-raw-date-label',
    claim: 'отдать подпись дня сырой датой, оставив форматирование разметке',
    mustRedden: 'подпись дня приходит готовой строкой',
    alsoRedden: [
      { name: 'отчёт несёт ряд из всех дней месяца, прочитанный тем же снимком', why: 'она сличает подпись первого дня отчёта — «1 марта»' },
    ],
    file: 'lib/metrics/sql.ts',
    find: '       extract(day from d.day)::int || \x27 \x27 ||\n',
    replace: '       to_char(d.day, \x27YYYY-MM-DD\x27) || \x27\x27 ||\n',
    tests: 'все',
  },
  {
    id: 'daily-not-in-report',
    claim: 'не прочитать ряд по дням в отчёте',
    mustRedden: 'отчёт несёт ряд из всех дней месяца, прочитанный тем же снимком',
    file: 'lib/metrics/report.ts',
    find: '    const dailyResult = await client.query(MONTH_DAILY, [dayParam])\n',
    replace: '    const dailyResult = { rows: [] as Array<Record<string, unknown>> }\n',
    tests: 'все',
  },

  // Шаг 2 — ряд на экране (задача Д-8) и высота его области (П5). Разметка ничего не считает; у
  // каждого дня доступная подпись; день без заказов — словами и пунктиром; месяц без заказов — словами.
  {
    id: 'daily-bar-other-value',
    claim: 'взять для высоты столбика дня не ту долю, что в отчёте',
    mustRedden: 'столбик дня берёт ту же долю и тот же край, что в отчёте',
    file: 'app/page.tsx',
    find: "'--day-size': день.sharePct",
    replace: "'--day-size': день.basePct",
    tests: 'все',
  },
  {
    id: 'daily-aria-dropped',
    claim: 'снять доступную подпись у дней ряда',
    mustRedden: 'у каждого дня доступная подпись с готовой строкой',
    alsoRedden: [
      { name: 'день без заказов — подпись словами, столбика нет, линия отсчёта помечена', why: 'она находит второй день по его доступной подписи' },
    ],
    file: 'app/page.tsx',
    find: "                  data-empty={день.net === null ? 'true' : undefined}\n                  aria-label={",
    replace: "                  data-empty={день.net === null ? 'true' : undefined}\n                  data-label={",
    tests: 'все',
  },
  {
    id: 'daily-empty-day-zero-label',
    claim: 'подписать день без заказов «0,00 €», а не словами',
    mustRedden: 'день без заказов — подпись словами, столбика нет, линия отсчёта помечена',
    file: 'app/page.tsx',
    find: "\x60${день.label}: заказов не было\x60",
    replace: "\x60${день.label}: ${money('0.00')}\x60",
    tests: 'все',
  },
  {
    id: 'daily-ticks-every-day',
    claim: 'подписать под осью каждый день, а не те, что дал отчёт',
    mustRedden: 'видимые подписи дней — ровно те, что дал отчёт',
    alsoRedden: [{ name: ПЕРЕПИСЬ, why: 'в её списке под осью две подписи, «1» и «6», а станет семь' }],
    file: 'app/page.tsx',
    find: '<li key={день.day}>{день.tick}</li>',
    replace: '<li key={день.day}>{день.label}</li>',
    tests: 'все',
  },
  {
    id: 'daily-empty-month-frame',
    claim: 'нарисовать месяцу без заказов пустой график вместо слов',
    mustRedden: 'месяц без заказов — слова «нет данных за месяц», а не пустой график',
    file: 'app/page.tsx',
    find: '{report.daily !== undefined && report.daily.hasOrders && (',
    replace: '{report.daily !== undefined && (',
    tests: 'все',
  },
  {
    id: 'daily-profit-word',
    claim: 'назвать блок ряда прибылью по дням',
    mustRedden: 'в блоке ряда слово «выручка» есть, а слова «прибыль» нет',
    alsoRedden: [
      { name: ПЕРЕПИСЬ, why: 'в её списке заголовок блока — «Чистая выручка по дням»' },
      { name: 'ряд рисуется только тогда, когда в отчёте есть его поле', why: 'она узнаёт блок по заголовку' },
    ],
    file: 'app/page.tsx',
    find: '<h2>Чистая выручка по дням</h2>',
    replace: '<h2>Прибыль по дням</h2>',
    tests: 'все',
  },
  {
    id: 'daily-dash-dropped',
    claim: 'снять пунктир под днём без заказов — оставить разрыв неотличимым от нуля по форме',
    mustRedden: 'у дня без заказов линия отсчёта — пунктиром: разрыв отличается от нуля формой',
    file: 'app/globals.css',
    find: "\n.daily-bars li[data-empty='true']::after {\n  border-top-style: dashed;\n}\n",
    replace: '\n',
    tests: 'все',
  },
  {
    id: 'daily-chart-height-foreign',
    claim: 'поставить высоте области ряда длину, не названную исключением',
    mustRedden: 'в таблице стилей нет ни одной величины и ни одного цвета вне набора Fluent 2',
    file: 'app/globals.css',
    find: '  grid-template-rows: 8rem auto;',
    replace: '  grid-template-rows: 9rem auto;',
    tests: 'все',
  },
]
