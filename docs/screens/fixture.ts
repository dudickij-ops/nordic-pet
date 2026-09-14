import type { MonthReport } from '@/lib/metrics/report'

/**
 * Раскладка настоящих мартовских чисел — для снимков экрана, и только для них.
 *
 * **Откуда она взялась.** Числа вынуты из снимка `obychnyy.html`, уже лежавшего в репозитории:
 * обратным разбором того, что печатают `money`, `percent`, `ratio` и `count`. Обратный разбор мог
 * ошибиться, и потому он не остался на веру — генератор сверяет **разметку** каждой созданной
 * страницы с эталоном побайтно, вместе с атрибутами, и расхождение в любой цифре эту сверку
 * красит.
 *
 * **Где эта сверка идёт.** Не только под `npm run screens`: обычный `npm test` тоже её проходит.
 * Проверка генератора (`__tests__/screens/generator.test.ts`, «собирает полный набор и сверяет
 * все десять страниц») собирает страницы из этой раскладки на подставном браузере, а эталоны берёт
 * по умолчанию из `docs/screens` — то есть из принятых страниц. Правка цифры здесь без пересборки
 * эталонов красит обычный прогон. Линтер и проверка типов этот файл тоже читают.
 *
 * Прежняя редакция этого места утверждала обратное — что `npm test`, линтер и сборка файл не
 * читают вовсе. Это было неверно; нашёл рецензент без контекста автора.
 *
 * **Чего эта сверка не ловит.** Одновременную правку раскладки и эталонов: пересобранные вместе,
 * они совпадут. Это не дыра, а устройство — эталоны и пересобираются ради сознательной правки.
 *
 * **Чем она не является.** Это не источник чисел и не второй экземпляр отчёта. Слой метрик её не
 * видит, ни одна проверка счёта её не читает, на экран в работе она не попадает. Снимок делается
 * без входа и без соединения — потому числа и лежат раскладкой, а не берутся запросом.
 */
export const МАРТ: MonthReport = {
  target: 'local',
  month: '2026-03',
  // Список месяцев выдуман: в источниках один март. Январь без заказов и февраль с заказами нужны
  // снимку пути с дельтами; путь, который на бою единственный, — раскладка МАРТ_БЕЗ_БАЗЫ ниже.
  months: [
    { month: '2026-01', hasOrders: false },
    { month: '2026-02', hasOrders: true },
    { month: '2026-03', hasOrders: true },
  ],
  revenue: { gross: '18764.00', discounts: '427.50', refunds: '1059.46', net: '17277.04' },
  costs: { cogs: '6028.11', ads: '4431.37', fees: '526.12', fixed: '4552.90' },
  bottom: { profit: '1738.53', marginPct: '10.1', roasByGross: '4.23' },
  items: [
    { sku: 'NP-004', units: '58', net: '2778.30', cogs: '1135.20', profit: '1643.10', marginPct: '59.1', profitSharePct: '14.6', loss: false },
    { sku: 'NP-012', units: '54', net: '2086.50', cogs: '834.60', profit: '1251.90', marginPct: '60.0', profitSharePct: '11.1', loss: false },
    { sku: 'NP-009', units: '36', net: '2070.90', cogs: '770.40', profit: '1300.50', marginPct: '62.8', profitSharePct: '11.6', loss: false },
    { sku: 'NP-003', units: '50', net: '1679.60', cogs: '340.00', profit: '1339.60', marginPct: '79.8', profitSharePct: '11.9', loss: false },
    { sku: 'NP-002', units: '83', net: '1581.45', cogs: '531.20', profit: '1050.25', marginPct: '66.4', profitSharePct: '9.3', loss: false },
    { sku: 'NP-010', units: '62', net: '1444.80', cogs: '514.60', profit: '930.20', marginPct: '64.4', profitSharePct: '8.3', loss: false },
    { sku: 'NP-011', units: '47', net: '1322.40', cogs: '528.96', profit: '793.44', marginPct: '60.0', profitSharePct: '7.1', loss: false },
    { sku: 'NP-006', units: '51', net: '1109.25', cogs: '402.90', profit: '706.35', marginPct: '63.7', profitSharePct: '6.3', loss: false },
    { sku: 'NP-008', units: '58', net: '904.00', cogs: '272.60', profit: '631.40', marginPct: '69.8', profitSharePct: '5.6', loss: false },
    { sku: 'NP-001', units: '59', net: '856.75', cogs: '300.90', profit: '555.85', marginPct: '64.9', profitSharePct: '4.9', loss: false },
    { sku: 'NP-007', units: '74', net: '723.69', cogs: '192.40', profit: '531.29', marginPct: '73.4', profitSharePct: '4.7', loss: false },
    { sku: 'NP-005', units: '67', net: '719.40', cogs: '204.35', profit: '515.05', marginPct: '71.6', profitSharePct: '4.6', loss: false },
  ],
  honesty: { sharePct: '80.3', skusWithoutPrice: ['NP-011', 'NP-012'] },
  gaps: [
    { kind: 'скидки', count: 0, at: [] },
    { kind: 'оборот', count: 0, at: [] },
    { kind: 'возвраты без суммы', count: 0, at: [] },
    { kind: 'возвраты, не попавшие в счёт', count: 0, at: [] },
    { kind: 'возвращено больше, чем куплено', count: 0, at: [] },
    { kind: 'строки продаж без цены поставщика', count: 77, at: ['NP-011', 'NP-012'] },
    { kind: 'ставки без процента или без фиксированной части', count: 0, at: [] },
    { kind: 'заказы с разными способами оплаты', count: 0, at: [] },
    { kind: 'постоянные расходы без суммы', count: 0, at: [] },
    { kind: 'реклама без суммы', count: 0, at: [] },
    { kind: 'дни рекламы без курса', count: 0, at: [] },
  ],  // ——— Кусок S11. Происхождение — по полю, а не по раскладке целиком (правило владельца). ———
  // Посчитано запросами куска по сверенным итогам и строкам выше: водопад, окупаемость, колонки товаров
  // и строка над таблицей, значения полосы показателей. Снято живым заходом 11 сентября 2026 года
  // (местная база, после — возврат посевом с наблюдением; разрешение владельца): ряд по дням за 31 день
  // и время чтения источников; тем же заходом итоги, водопад, окупаемость и строка над таблицей совпали
  // с числами здесь. Выдумано: дельты полосы — от выдуманного февраля (16 020,00 € оборота, 14 880,30 €
  // чистой выручки, 4 102,00 € рекламы, 1 902,14 € прибыли, маржа 12,8 %): настоящего февраля нет.
  waterfall: {
    steps: [
      { key: 'gross', kind: 'итог', amount: '18764.00', sharePct: '100.0', basePct: '0.0', largest: false },
      { key: 'discounts', kind: 'вычитание', amount: '427.50', sharePct: '2.3', basePct: '97.7', largest: false },
      { key: 'refunds', kind: 'вычитание', amount: '1059.46', sharePct: '5.6', basePct: '92.1', largest: false },
      { key: 'net', kind: 'итог', amount: '17277.04', sharePct: '92.1', basePct: '0.0', largest: false },
      { key: 'cogs', kind: 'вычитание', amount: '6028.11', sharePct: '32.1', basePct: '59.9', largest: true },
      { key: 'ads', kind: 'вычитание', amount: '4431.37', sharePct: '23.6', basePct: '36.3', largest: false },
      { key: 'fees', kind: 'вычитание', amount: '526.12', sharePct: '2.8', basePct: '33.5', largest: false },
      { key: 'fixed', kind: 'вычитание', amount: '4552.90', sharePct: '24.3', basePct: '9.3', largest: false },
      { key: 'profit', kind: 'итог', amount: '1738.53', sharePct: '9.3', basePct: '0.0', largest: false },
    ],
    scaleLowPct: '0.0',
    scaleHighPct: '100.0',
    netGap: null,
    profitGap: '0.01',
  },
  payback: {
    roasByProfit: '0.39',
    contributionPct: '57.1',
    breakevenRoas: '1.75',
    breakevenNote: null,
  },
  itemsSummary: { productsProfit: '11248.93', skusTotal: 12, skusFor80: 8, negativeCount: 0 },
  sourcesReadAt: '2026-09-11 07:47 UTC',
  daily: {
    days: [
      { day: '2026-03-01', label: '1 марта', net: '416.61', sharePct: '34.2', basePct: '0.0', tick: '1' },
      { day: '2026-03-02', label: '2 марта', net: '381.00', sharePct: '31.3', basePct: '0.0', tick: null },
      { day: '2026-03-03', label: '3 марта', net: '363.95', sharePct: '29.9', basePct: '0.0', tick: null },
      { day: '2026-03-04', label: '4 марта', net: '688.62', sharePct: '56.6', basePct: '0.0', tick: null },
      { day: '2026-03-05', label: '5 марта', net: '499.41', sharePct: '41.0', basePct: '0.0', tick: null },
      { day: '2026-03-06', label: '6 марта', net: '750.37', sharePct: '61.7', basePct: '0.0', tick: '6' },
      { day: '2026-03-07', label: '7 марта', net: '822.80', sharePct: '67.6', basePct: '0.0', tick: null },
      { day: '2026-03-08', label: '8 марта', net: '421.06', sharePct: '34.6', basePct: '0.0', tick: null },
      { day: '2026-03-09', label: '9 марта', net: null, sharePct: null, basePct: '0.0', tick: null },
      { day: '2026-03-10', label: '10 марта', net: '384.55', sharePct: '31.6', basePct: '0.0', tick: null },
      { day: '2026-03-11', label: '11 марта', net: '433.06', sharePct: '35.6', basePct: '0.0', tick: '11' },
      { day: '2026-03-12', label: '12 марта', net: '447.01', sharePct: '36.7', basePct: '0.0', tick: null },
      { day: '2026-03-13', label: '13 марта', net: '398.30', sharePct: '32.7', basePct: '0.0', tick: null },
      { day: '2026-03-14', label: '14 марта', net: '452.00', sharePct: '37.1', basePct: '0.0', tick: null },
      { day: '2026-03-15', label: '15 марта', net: '620.63', sharePct: '51.0', basePct: '0.0', tick: null },
      { day: '2026-03-16', label: '16 марта', net: '317.20', sharePct: '26.1', basePct: '0.0', tick: '16' },
      { day: '2026-03-17', label: '17 марта', net: '1162.01', sharePct: '95.5', basePct: '0.0', tick: null },
      { day: '2026-03-18', label: '18 марта', net: '486.62', sharePct: '40.0', basePct: '0.0', tick: null },
      { day: '2026-03-19', label: '19 марта', net: '293.21', sharePct: '24.1', basePct: '0.0', tick: null },
      { day: '2026-03-20', label: '20 марта', net: '969.55', sharePct: '79.7', basePct: '0.0', tick: null },
      { day: '2026-03-21', label: '21 марта', net: '1216.78', sharePct: '100.0', basePct: '0.0', tick: '21' },
      { day: '2026-03-22', label: '22 марта', net: '556.91', sharePct: '45.8', basePct: '0.0', tick: null },
      { day: '2026-03-23', label: '23 марта', net: '770.36', sharePct: '63.3', basePct: '0.0', tick: null },
      { day: '2026-03-24', label: '24 марта', net: '623.57', sharePct: '51.2', basePct: '0.0', tick: null },
      { day: '2026-03-25', label: '25 марта', net: '515.90', sharePct: '42.4', basePct: '0.0', tick: null },
      { day: '2026-03-26', label: '26 марта', net: '314.70', sharePct: '25.9', basePct: '0.0', tick: '26' },
      { day: '2026-03-27', label: '27 марта', net: '531.46', sharePct: '43.7', basePct: '0.0', tick: null },
      { day: '2026-03-28', label: '28 марта', net: '528.70', sharePct: '43.5', basePct: '0.0', tick: null },
      { day: '2026-03-29', label: '29 марта', net: '692.65', sharePct: '56.9', basePct: '0.0', tick: null },
      { day: '2026-03-30', label: '30 марта', net: '701.90', sharePct: '57.7', basePct: '0.0', tick: null },
      { day: '2026-03-31', label: '31 марта', net: '516.15', sharePct: '42.4', basePct: '0.0', tick: '31' },
    ],
    scaleLowPct: '0.0',
    scaleHighPct: '100.0',
    topNet: '1216.78',
    bottomNet: '0.00',
    hasOrders: true,
  },
  kpis: {
    prevMonth: '2026-02',
    hasBase: true,
    items: [
      { key: 'profit', unit: 'eur', value: '1738.53', delta: '-163.61', verdict: 'хуже' },
      { key: 'margin', unit: 'pp', value: '10.1', delta: '-2.7', verdict: 'хуже' },
      { key: 'net', unit: 'eur', value: '17277.04', delta: '+2396.74', verdict: 'лучше' },
      { key: 'ad_share', unit: 'pp', value: '23.6', delta: '-2.0', verdict: 'лучше' },
    ],
  },
}

/**
 * «Главное» на пути «нет базы для сравнения» — решение владельца по Е1: этот путь боевой, и на настоящих
 * данных он единственный. Отличие от раскладки выше — два поля, оба настоящие: в источниках один месяц,
 * и у марта нет прошлого месяца с заказами, поэтому дельт нет; значения полосы — те же, что выше.
 */
export const МАРТ_БЕЗ_БАЗЫ: MonthReport = {
  ...МАРТ,
  months: [{ month: '2026-03', hasOrders: true }],
  kpis: {
    prevMonth: '2026-02',
    hasBase: false,
    items: [
      { key: 'profit', unit: 'eur', value: '1738.53', delta: null, verdict: null },
      { key: 'margin', unit: 'pp', value: '10.1', delta: null, verdict: null },
      { key: 'net', unit: 'eur', value: '17277.04', delta: null, verdict: null },
      { key: 'ad_share', unit: 'pp', value: '23.6', delta: null, verdict: null },
    ],
  },
}

/**
 * Отказ шага обновления — тот же, что на снимке `otkaz-shaga.html`.
 *
 * Текст отказа принадлежит слою обновления, а не снимку; здесь он лежит раскладкой ровно потому,
 * что снимок делается без соединения и настоящего отказа получить неоткуда.
 */
export const ОТКАЗ_ШАГА = {
  ok: false as const,
  step: 'папка' as const,
  text: 'папка ads-exports не прочиталась: ключ не подошёл',
  stale: true,
}

/** Отказ входа — тот же, что на снимке `vhod.html`. */
export const ОТКАЗ_ВХОДА = { ok: false as const, text: 'Логин или пароль не подошли.' }
