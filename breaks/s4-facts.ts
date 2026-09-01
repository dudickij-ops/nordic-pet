import type { Break } from './types.ts'

/**
 * Список сломов куска S4 — разбора сырых строк и заполнения слоя фактов.
 *
 * Это тот самый список, который печатается таблицей в отчёте: другого нет. Строка,
 * которой здесь не написано, не проверена — и это видно, а не подразумевается.
 */

const PARSE = 'lib/facts/parse.ts'
const ADS = 'lib/facts/ads.ts'
const BUILD = 'lib/facts/build.ts'
const MIGRATION = 'supabase/migrations/20260901230000_fact_write.sql'
const COMMAND = 'scripts/build-facts.ts'

const PARSE_TESTS = '__tests__/facts/parse.test.ts'
const ADS_TESTS = '__tests__/facts/ads.test.ts'
const BUILD_TESTS = '__tests__/facts/build.test.ts'
const WRITE_TESTS = '__tests__/db/fact-write.test.ts'
const COMMAND_TESTS = '__tests__/facts/command.test.ts'

export const BREAKS: Break[] = [
  // --- разбор значений ----------------------------------------------------------------
  {
    id: 'date-euro',
    claim: 'убрать разбор `ДД.ММ.ГГГГ`',
    mustRedden: 'обе формы источника разбираются в одну и ту же дату',
    file: PARSE,
    find: 'const EURO_DATE = /^(\\d{2})\\.(\\d{2})\\.(\\d{4})$/',
    replace: 'const EURO_DATE = /^(?!)$/',
    tests: PARSE_TESTS,
  },
  {
    id: 'date-impossible',
    claim: 'принять `31.02.2026`',
    mustRedden: 'несуществующая дата — отказ',
    file: PARSE,
    find: '  if (!isRealDate(Number(year), Number(month), Number(day))) {',
    replace: '  if (false) {',
    tests: PARSE_TESTS,
  },
  {
    id: 'date-third-form',
    claim: 'принять третью форму даты',
    mustRedden: 'третья форма даты не угадывается',
    file: PARSE,
    find: `  const iso = ISO_DATE.exec(value)
  const euro = EURO_DATE.exec(value)
  if (iso === null && euro === null) {`,
    replace: `  const iso = ISO_DATE.exec(value)
  const euro = EURO_DATE.exec(value)
  if (iso === null && euro === null) {
    return value
  }
  if (false) {`,
    tests: PARSE_TESTS,
  },
  {
    id: 'date-month-day-swap',
    claim: 'читать форму с точками как `ММ.ДД.ГГГГ`',
    mustRedden: 'форма с точками читается как день-месяц-год',
    file: PARSE,
    find: '      : [(euro as RegExpExecArray)[3], (euro as RegExpExecArray)[2], (euro as RegExpExecArray)[1]]',
    replace: '      : [(euro as RegExpExecArray)[3], (euro as RegExpExecArray)[1], (euro as RegExpExecArray)[2]]',
    tests: PARSE_TESTS,
  },
  {
    id: 'month-euro',
    claim: 'убрать разбор `ММ.ГГГГ`',
    mustRedden: 'обе формы месяца дают первый день месяца',
    file: PARSE,
    find: 'const EURO_MONTH = /^(\\d{2})\\.(\\d{4})$/',
    replace: 'const EURO_MONTH = /^(?!)$/',
    tests: PARSE_TESTS,
  },
  {
    id: 'money-spaces',
    claim: 'убрать снятие неразрывного пробела',
    mustRedden: 'пробел-разделитель тысяч снимается во всех трёх написаниях',
    file: PARSE,
    find: "  const value = raw.replace(THOUSAND_SPACES, '')",
    replace: '  const value = raw',
    tests: PARSE_TESTS,
  },
  {
    id: 'money-first-separator',
    claim: 'считать десятичным первый разделитель',
    mustRedden: 'при двух разделителях десятичный — последний',
    file: PARSE,
    find: "    const decimal = value.lastIndexOf('.') > value.lastIndexOf(',') ? '.' : ','",
    replace: "    const decimal = value.indexOf('.') < value.indexOf(',') ? '.' : ','",
    tests: PARSE_TESTS,
  },
  {
    id: 'money-extra-digits',
    claim: 'разрешить лишние знаки после запятой',
    mustRedden: 'лишние знаки после запятой — отказ',
    file: PARSE,
    find: '  if (fraction.length > scale) {',
    replace: '  if (false) {',
    tests: PARSE_TESTS,
  },
  {
    id: 'money-repeated-separator',
    claim: 'разрешить повторённый одиночный разделитель',
    mustRedden: 'повторённый одиночный разделитель не угадывается',
    file: PARSE,
    find: '  } else if (dots + commas > 1) {',
    replace: '  } else if (false) {',
    tests: PARSE_TESTS,
  },
  {
    id: 'money-grouping',
    claim: 'убрать проверку группировки пробелов',
    mustRedden: 'непонятое число — отказ: 1 2',
    file: PARSE,
    find: '    if (!SPACED_NUMBER.test(raw)) {',
    replace: '    if (false) {',
    tests: PARSE_TESTS,
  },
  {
    id: 'money-as-number',
    claim: 'вернуть деньги числом вместо строки',
    mustRedden: 'деньги возвращаются строкой, а не числом',
    file: PARSE,
    find: `  return normalized
}

/** Количество штук`,
    replace: `  return Number(normalized) as unknown as string
}

/** Количество штук`,
    tests: PARSE_TESTS,
  },
  {
    id: 'money-empty-as-zero',
    claim: 'писать ноль вместо пустой денежной ячейки',
    mustRedden: 'пустая денежная ячейка',
    file: PARSE,
    find: "  if (raw === '') return null",
    replace: "  if (raw === '') return '0'",
    tests: PARSE_TESTS,
  },
  {
    id: 'units-zero',
    claim: 'принять ноль или отрицательные штуки',
    mustRedden: 'отказ на нуле говорит, что строка с нулём штук не продажа',
    file: PARSE,
    find: '  if (units <= 0) {',
    replace: '  if (false) {',
    tests: PARSE_TESTS,
  },
  {
    id: 'sku-dashes',
    claim: 'убрать замену неразрывного дефиса',
    mustRedden: 'прочие дефисы-не-дефисы тоже приводятся',
    file: PARSE,
    find: "    .replace(DASHES, '-')\n",
    replace: '',
    tests: PARSE_TESTS,
  },
  {
    id: 'sku-spaces',
    claim: 'убрать снятие пробелов в артикуле',
    mustRedden: 'пробелы снимаются все, а не только крайние',
    file: PARSE,
    find: "    .replace(/\\s/g, '')\n",
    replace: '',
    tests: PARSE_TESTS,
  },
  {
    id: 'sku-case',
    claim: 'убрать подъём регистра артикула',
    mustRedden: 'три написания одного товара из источника сходятся в одно',
    file: PARSE,
    find: '    .toUpperCase()',
    replace: '',
    tests: PARSE_TESTS,
  },
  {
    id: 'required-text',
    claim: 'пропустить пустую ключевую ячейку',
    mustRedden: 'пустое значение — отказ, называющий столбец',
    file: PARSE,
    find: `  if (value === '') {
    throw new CellError(at, 'значение не заполнено, а без него строка не опознаётся')
  }`,
    replace: '',
    tests: PARSE_TESTS,
  },

  // --- площадка и свёртка копий -------------------------------------------------------
  {
    id: 'platform-refusal',
    claim: 'не отказывать на имени файла без площадки',
    mustRedden: 'имя, из которого площадку не вывести, — отказ',
    file: ADS,
    find: `  if (platform === '') {
    throw new Error(
      \`из имени файла «\${fileName}» не вывести площадку. Имя выгрузки начинается с названия \` +
        'площадки и знака подчёркивания: meta_2026-03.csv, google_2026-03.csv',
    )
  }`,
    replace: `  if (platform === '') {
    return 'неизвестно'
  }`,
    tests: ADS_TESTS,
  },
  {
    id: 'platform-case',
    claim: 'не снимать регистр в имени площадки',
    mustRedden: 'регистр имени снимается',
    file: ADS,
    find: 'name.slice(0, underscore).trim().toLowerCase()',
    replace: 'name.slice(0, underscore).trim()',
    tests: ADS_TESTS,
  },
  {
    id: 'fold-by-name',
    claim: 'опознавать копию по имени или по времени, а не по содержимому',
    mustRedden: 'одинаковые имена площадки с разным содержимым копиями не считаются',
    file: ADS,
    find: '    const fingerprint = fingerprintOf(file)',
    replace: '    const fingerprint = file.platform',
    tests: ADS_TESTS,
  },
  {
    id: 'fold-with-row-no',
    claim: 'включить адрес строки в отпечаток файла',
    mustRedden: 'адрес строки в отпечаток не входит',
    file: ADS,
    find: '  return JSON.stringify([file.platform, rows.map((row) => [row.date, row.campaign, row.spend])])',
    replace: '  return JSON.stringify([file.platform, rows.map((row) => [row.rowNo, row.date, row.campaign, row.spend])])',
    tests: ADS_TESTS,
  },
  {
    id: 'fold-without-platform',
    claim: 'убрать площадку из отпечатка файла',
    mustRedden: 'совпавшее содержимое у РАЗНЫХ площадок копией не делает',
    file: ADS,
    find: '  return JSON.stringify([file.platform, rows.map((row) => [row.date, row.campaign, row.spend])])',
    replace: '  return JSON.stringify([rows.map((row) => [row.date, row.campaign, row.spend])])',
    tests: ADS_TESTS,
  },
  {
    id: 'fold-row-order',
    claim: 'не упорядочивать строки файла перед отпечатком',
    mustRedden: 'порядок строк внутри файла на опознание не влияет',
    file: ADS,
    find: '  const rows = [...file.rows].sort((a, b) => a.rowNo - b.rowNo)',
    replace: '  const rows = file.rows',
    tests: ADS_TESTS,
  },
  {
    id: 'survivor-input-order',
    claim: 'выбирать пережившего по порядку входа',
    mustRedden: 'выбор пережившего не зависит от порядка файлов на входе',
    file: ADS,
    find: '  return [...names].sort((a, b) => (a.length !== b.length ? a.length - b.length : a < b ? -1 : 1))[0]',
    replace: '  return names[0]',
    tests: ADS_TESTS,
  },
  {
    id: 'survivor-locale',
    claim: 'сравнивать имена с учётом языка среды',
    mustRedden: 'при равной длине имён переживает первое по порядку кодовых знаков',
    file: ADS,
    find: '  return [...names].sort((a, b) => (a.length !== b.length ? a.length - b.length : a < b ? -1 : 1))[0]',
    replace: '  return [...names].sort((a, b) => (a.length !== b.length ? a.length - b.length : a.localeCompare(b)))[0]',
    tests: ADS_TESTS,
  },

  // --- запись фактов ------------------------------------------------------------------
  {
    id: 'write-is-distinct-from',
    claim: 'убрать условие `is distinct from` в записи',
    mustRedden: 'неизменившаяся строка не переписывается',
    file: MIGRATION,
    find: `       where (t.date, t.usd_per_eur)
          is distinct from (excluded.date, excluded.usd_per_eur);`,
    replace: ';',
    tests: WRITE_TESTS,
    resetDb: true,
  },
  {
    id: 'write-delete',
    claim: 'убрать удаление в записи фактов',
    mustRedden: 'адрес, которого в снимке больше нет, удаляется',
    file: MIGRATION,
    find: `  delete from fact.fx t
   where not exists (
     select 1 from jsonb_array_elements(p_rows) as r
      where (r->>'row_no')::integer = t.row_no
   );`,
    replace: '',
    tests: WRITE_TESTS,
    resetDb: true,
  },
  {
    id: 'write-empty-snapshot-guard',
    claim: 'разрешить нулевой снимок при непустом сырье',
    mustRedden: 'непустое сырьё при нуле фактов',
    file: MIGRATION,
    find: '  if jsonb_array_length(p_rows) = 0 and exists (select 1 from raw.opex) then',
    replace: '  if false then',
    tests: WRITE_TESTS,
    resetDb: true,
  },
  {
    id: 'write-empty-snapshot-unconditional',
    claim: 'отказывать на нулевом снимке при пустом сырье',
    mustRedden: 'пустое сырьё даёт пустые факты без отказа',
    file: MIGRATION,
    find: '  if jsonb_array_length(p_rows) = 0 and exists (select 1 from raw.opex) then',
    replace: '  if jsonb_array_length(p_rows) = 0 then',
    tests: WRITE_TESTS,
    resetDb: true,
  },
  {
    id: 'write-not-an-array',
    claim: 'убрать отказ «снимок не массив»',
    mustRedden: 'снимок не массив',
    file: MIGRATION,
    find: `  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'снимок для fact.fx не массив: разбор позвал запись неправильно';
  end if;`,
    replace: '',
    tests: WRITE_TESTS,
    resetDb: true,
  },
  {
    id: 'key-fx',
    claim: 'снять уникальность по дате курса',
    mustRedden: 'два курса на одну дату — отказ',
    file: MIGRATION,
    find: `alter table fact.fx
  add constraint fx_one_rate_per_day
  unique nulls not distinct (date) deferrable initially deferred;`,
    replace: '',
    tests: WRITE_TESTS,
    resetDb: true,
  },
  {
    id: 'key-fx-nulls',
    claim: 'поставить указатели без `nulls not distinct`',
    mustRedden: 'две пустые даты курса тоже считаются одним ключом',
    file: MIGRATION,
    find: '  unique nulls not distinct (date) deferrable initially deferred;',
    replace: '  unique (date) deferrable initially deferred;',
    tests: WRITE_TESTS,
    resetDb: true,
  },
  {
    id: 'key-fx-deferred',
    claim: 'снять отложенность делового ключа',
    mustRedden: 'деловые ключи могут обменяться между строками внутри одной записи',
    file: MIGRATION,
    find: '  unique nulls not distinct (date) deferrable initially deferred;',
    replace: '  unique nulls not distinct (date);',
    tests: WRITE_TESTS,
    resetDb: true,
  },
  {
    id: 'key-costs',
    claim: 'снять уникальность по артикулу и дате цены',
    mustRedden: 'две цены на один артикул и одну дату начала — отказ',
    file: MIGRATION,
    find: `alter table fact.costs
  add constraint costs_one_price_per_sku_and_start
  unique nulls not distinct (sku, valid_from) deferrable initially deferred;`,
    replace: '',
    tests: WRITE_TESTS,
    resetDb: true,
  },
  {
    id: 'key-costs-narrow',
    claim: 'сузить ключ цены до одного артикула без даты',
    mustRedden: 'две цены на один артикул с разными датами начала — законно',
    file: MIGRATION,
    find: '  unique nulls not distinct (sku, valid_from) deferrable initially deferred;',
    replace: '  unique nulls not distinct (sku) deferrable initially deferred;',
    tests: WRITE_TESTS,
    resetDb: true,
  },
  {
    id: 'key-fees',
    claim: 'снять уникальность по шлюзу',
    mustRedden: 'две ставки на один способ оплаты — отказ',
    file: MIGRATION,
    find: `alter table fact.fees
  add constraint fees_one_rate_per_gateway
  unique nulls not distinct (gateway) deferrable initially deferred;`,
    replace: '',
    tests: WRITE_TESTS,
    resetDb: true,
  },
  {
    id: 'key-ads',
    claim: 'снять уникальность по площадке, дате и кампании',
    mustRedden: 'две строки рекламы на площадку, день и кампанию — отказ',
    file: MIGRATION,
    find: `alter table fact.ads
  add constraint ads_one_row_per_platform_day_campaign
  unique nulls not distinct (platform, date, campaign) deferrable initially deferred;`,
    replace: '',
    tests: WRITE_TESTS,
    resetDb: true,
  },
  {
    id: 'key-ads-without-platform',
    claim: 'убрать площадку из ключа рекламы',
    mustRedden: 'те же дата и кампания у разных площадок — законно',
    file: MIGRATION,
    find: '  unique nulls not distinct (platform, date, campaign) deferrable initially deferred;',
    replace: '  unique nulls not distinct (date, campaign) deferrable initially deferred;',
    tests: WRITE_TESTS,
    resetDb: true,
  },
  {
    id: 'percent-range',
    claim: 'снять ограничение диапазона процента',
    mustRedden: 'нулевая и отрицательная ставка — наш отказ',
    file: MIGRATION,
    find: '  check (percent is null or percent > 0);',
    replace: '  check (true);',
    tests: WRITE_TESTS,
    resetDb: true,
  },

  // --- сборка -------------------------------------------------------------------------
  {
    id: 'stop-at-first-cell',
    claim: 'останавливать разбор на первой непонятой ячейке',
    mustRedden: 'непонятые ячейки называются все разом',
    file: BUILD,
    find: `  cell<T>(run: () => T): T | undefined {
    try {
      return run()
    } catch (error) {
      this.found.push(error instanceof CellError ? error.message : (error as Error).message)
      return undefined
    }
  }`,
    replace: `  cell<T>(run: () => T): T | undefined {
    return run()
  }`,
    tests: BUILD_TESTS,
  },
  {
    id: 'currency-orders',
    claim: 'убрать валюту у заказов',
    mustRedden: 'валюта проставлена всем',
    file: BUILD,
    find: `        currency: EUR,
        gateway: problems.cell(() => requireText(text(row, 'gateway'), at('gateway'))),`,
    replace: `        currency: null as unknown as string,
        gateway: problems.cell(() => requireText(text(row, 'gateway'), at('gateway'))),`,
    tests: BUILD_TESTS,
  },
  {
    id: 'currency-ads',
    claim: 'поставить рекламе `EUR`',
    mustRedden: 'валюта проставлена всем',
    file: BUILD,
    find: '        currency: USD,',
    replace: '        currency: EUR,',
    tests: BUILD_TESTS,
  },
  {
    id: 'platform-not-derived',
    claim: 'убрать вывод площадки',
    mustRedden: 'площадка выведена у каждой строки рекламы',
    file: BUILD,
    find: '        const platform = problems.cell(() => platformOf(fileName))',
    replace: "        const platform = 'неизвестно' as string | undefined",
    tests: BUILD_TESTS,
  },
  {
    id: 'no-folding',
    claim: 'писать в факты обе копии `meta`',
    mustRedden: 'семь таблиц фактов наполняются из семи сырых',
    file: BUILD,
    find: '    const { kept, folded } = foldCopies([...byFile.values()])',
    replace: `    const kept = [...byFile.values()]
    const folded: Array<{ fileName: string; copyOf: string; rows: number }> = []`,
    tests: BUILD_TESTS,
  },
  {
    id: 'contradiction-before-normalising',
    claim: 'сверять противоречия до приведения артикулов',
    mustRedden: 'противоречие ищется после приведения артикулов',
    file: BUILD,
    find: `        sku: problems.cell(() => parseSku(text(row, 'sku'), at('sku'))),
        cost: problems.cell(() => parseAmount(text(row, 'cost_eur'), at('cost_eur'), MONEY)),`,
    replace: `        sku: problems.cell(() => requireText(text(row, 'sku'), at('sku'))),
        cost: problems.cell(() => parseAmount(text(row, 'cost_eur'), at('cost_eur'), MONEY)),`,
    tests: BUILD_TESTS,
  },
  {
    id: 'ads-collision-one-text',
    claim: 'дать столкновению по ключу рекламы один текст на оба случая',
    mustRedden: 'строки из одного файла',
    file: BUILD,
    find: '      if (files.length > 1) {',
    replace: '      if (true) {',
    tests: BUILD_TESTS,
  },
  {
    id: 'order-gateway-split',
    claim: 'пропустить разные способы оплаты в одном заказе',
    mustRedden: 'разные способы оплаты в строках одног',
    file: BUILD,
    find: '      if (gateways.size > 1) {',
    replace: '      if (false) {',
    tests: BUILD_TESTS,
  },
  {
    id: 'order-date-split',
    claim: 'пропустить разные даты в одном заказе',
    mustRedden: 'разные даты в строках одного заказа',
    file: BUILD,
    find: '      if (dates.size > 1) {',
    replace: '      if (false) {',
    tests: BUILD_TESTS,
  },
  {
    id: 'ads-day-without-rate',
    claim: 'пропустить дату рекламы без курса',
    mustRedden: 'день рекламы без курса',
    file: BUILD,
    find: '    if (daysWithoutRate.length > 0) {',
    replace: '    if (false) {',
    tests: BUILD_TESTS,
  },
  {
    id: 'gateway-without-fee',
    claim: 'пропустить шлюз без ставки комиссии',
    mustRedden: 'способ оплаты без ставки комиссии',
    file: BUILD,
    find: '    if (gatewaysWithoutFee.length > 0) {',
    replace: '    if (false) {',
    tests: BUILD_TESTS,
  },
  {
    id: 'refuse-missing-cost',
    claim: 'отказать на артикуле без цены поставщика',
    mustRedden: 'товар без цены поставщика — не отказ',
    file: BUILD,
    find: '    const ratedGateways = new Set(fees.map((row) => String(row.gateway)))',
    replace: `    if (costs.length < orders.length) contradictions.add('нет цены поставщика')
    const ratedGateways = new Set(fees.map((row) => String(row.gateway)))`,
    tests: BUILD_TESTS,
  },
  {
    id: 'no-twins',
    claim: 'убрать подсчёт строк-близнецов',
    mustRedden: 'задвоенная до последней колонки строка заказа названа числом и адресом',
    file: BUILD,
    find: `    const twins = [
      twinsOf('orders', orders as Array<Record<string, unknown>>),
      twinsOf('refunds', refunds as Array<Record<string, unknown>>),
    ]`,
    replace: '    const twins: TwinReport[] = []',
    tests: BUILD_TESTS,
  },
  {
    id: 'twins-with-address',
    claim: 'включить адрес строки в сравнение близнецов',
    mustRedden: 'задвоенная до последней колонки строка заказа названа числом и адресом',
    file: BUILD,
    find: '    const { row_no: address, ...content } = row',
    replace: `    const address = row.row_no as number
    const content = row`,
    tests: BUILD_TESTS,
  },
  {
    id: 'twins-before-normalising',
    claim: 'сравнивать близнецов до приведения артикулов',
    mustRedden: 'задвоенный возврат назван так же',
    file: BUILD,
    find: `        sku: problems.cell(() => parseSku(text(row, 'sku'), at('sku'))),
        units: problems.cell(() => parseUnits(text(row, 'units'), at('units'))),
        amount: problems.cell(() => parseAmount(text(row, 'amount_eur'), at('amount_eur'), MONEY)),`,
    replace: `        sku: problems.cell(() => requireText(text(row, 'sku'), at('sku'))),
        units: problems.cell(() => parseUnits(text(row, 'units'), at('units'))),
        amount: problems.cell(() => parseAmount(text(row, 'amount_eur'), at('amount_eur'), MONEY)),`,
    tests: BUILD_TESTS,
  },
  {
    id: 'twins-loose-key',
    claim: 'считать близнецом строку с одной отличающейся колонкой',
    mustRedden: 'строка, отличающаяся хоть одной колонкой, близнецом не считается',
    file: BUILD,
    find: '    const { row_no: address, ...content } = row',
    replace: '    const { row_no: address, units: _units, ...content } = row',
    tests: BUILD_TESTS,
  },
  {
    id: 'constraints-not-checked',
    claim: 'не проверять деловые ключи до конца работы',
    mustRedden: 'деловые ключи проверяются до конца работы',
    file: BUILD,
    find: "    await client.query('set constraints all immediate')",
    replace: '',
    tests: BUILD_TESTS,
  },
  {
    id: 'raw-read-outside-transaction',
    claim: 'читать сырьё вне транзакции записи',
    mustRedden: 'сырьё читается внутри той же транзакции',
    file: BUILD,
    find: `    await client.query('begin')

    const raw = {`,
    replace: '    const raw = {',
    tests: BUILD_TESTS,
  },
  {
    id: 'write-to-raw',
    claim: 'написать в `raw` хоть один оператор',
    mustRedden: 'в сырьё не посылается ни одного оператора записи',
    file: BUILD,
    find: "    await client.query('set constraints all immediate')",
    replace: `    await client.query('update raw.fx set usd_per_eur = usd_per_eur')
    await client.query('set constraints all immediate')`,
    tests: BUILD_TESTS,
  },
  {
    id: 'incremental-parse',
    claim: 'разбирать только новое сырьё',
    mustRedden: 'исправленная человеком ячейка сырья пересчитывается',
    file: BUILD,
    find: '      if (problems.count === before) orders.push(parsed)',
    replace: '      if (problems.count === before && (row.row_no as number) !== 1) orders.push(parsed)',
    tests: BUILD_TESTS,
  },
  {
    id: 'facts-in-parts',
    claim: 'писать факты частями, не одной транзакцией',
    mustRedden: 'при отказе в слое фактов не появилось ни одной строки',
    file: BUILD,
    find: '      await client.query(`select fact.${fn}($1::jsonb)`, [JSON.stringify(rows)])',
    replace: `      await client.query('commit')
      await client.query('begin')
      await client.query(\`select fact.\${fn}($1::jsonb)\`, [JSON.stringify(rows)])`,
    tests: BUILD_TESTS,
  },
  {
    id: 'pg-env-not-cleared',
    claim: 'убрать снятие переменных `PG*`',
    mustRedden: 'переменные PG* сняты до соединения',
    file: BUILD,
    find: '  clearPostgresEnvironment()',
    replace: '  // clearPostgresEnvironment()',
    tests: 'все',
  },
  {
    id: 'announce-after-work',
    claim: 'называть цель после записи',
    mustRedden: 'цель называется первой строкой, до всякой работы',
    file: BUILD,
    find: `  const target = resolveIngestTarget()
  announce(target.label)`,
    replace: '  const target = resolveIngestTarget()',
    andThen: {
      find: "    await client.query('commit')\n",
      replace: "    await client.query('commit')\n    announce(target.label)\n",
    },
    tests: 'все',
  },
  {
    id: 'network-in-build',
    claim: 'позвать сеть',
    mustRedden: 'сборка не ходит наружу',
    file: BUILD,
    find: "import { clearPostgresEnvironment } from '../db-url.ts'",
    replace: `import { googleAuth } from '../ingest/google-access.ts'
import { clearPostgresEnvironment } from '../db-url.ts'
void googleAuth`,
    tests: 'все',
  },

  // --- команда ------------------------------------------------------------------------
  {
    id: 'command-no-target-refusal',
    claim: 'убрать отказ на неназванной среде',
    mustRedden: 'не ходит в базу, пока среда не названа',
    file: BUILD,
    find: '  const target = resolveIngestTarget()',
    replace:
      "  const target = resolveIngestTarget({ ...process.env, NORDIC_PET_DB_TARGET: process.env.NORDIC_PET_DB_TARGET === undefined || process.env.NORDIC_PET_DB_TARGET === '' ? 'local' : process.env.NORDIC_PET_DB_TARGET })",
    tests: COMMAND_TESTS,
  },
  {
    id: 'command-twins-only-when-found',
    claim: 'печатать близнецов только когда их больше нуля',
    mustRedden: 'печатает ноль близнецов числом',
    file: COMMAND,
    find: `  console.log(
    \`\\nблизнецов: \${report.twins.map((twin) => \`\${twin.table} — \${twin.rows}\`).join(', ')}\`,
  )`,
    replace: `  const found = report.twins.filter((twin) => twin.rows > 0)
  if (found.length > 0) {
    console.log(\`\\nблизнецов: \${found.map((twin) => \`\${twin.table} — \${twin.rows}\`).join(', ')}\`)
  }`,
    tests: COMMAND_TESTS,
  },
  {
    id: 'command-no-folded',
    claim: 'не печатать свёрнутые копии',
    mustRedden: 'печатает цель первой строкой и весь отчёт',
    file: COMMAND,
    find: `  console.log(
    \`\\nсвёрнуто копий: \${
      report.folded
        .map((file) => \`\${file.fileName} — копия \${file.copyOf}, \${file.rows} строк\`)
        .join('; ') || '—'
    }\`,
  )`,
    replace: '',
    tests: COMMAND_TESTS,
  },
  {
    id: 'command-no-platforms',
    claim: 'не печатать площадки',
    mustRedden: 'печатает цель первой строкой и весь отчёт',
    file: COMMAND,
    find: "  console.log(`площадки: ${report.platforms.join(', ') || '—'}`)",
    replace: '',
    tests: COMMAND_TESTS,
  },
  {
    id: 'command-alias-import',
    claim: 'написать команду через сокращение `@/`',
    mustRedden: 'запускается простым node',
    file: COMMAND,
    find: "import { buildFacts } from '../lib/facts/build.ts'",
    replace: "import { buildFacts } from '@/lib/facts/build.ts'",
    tests: COMMAND_TESTS,
  },
  {
    id: 'command-no-exit-code',
    claim: 'не завершать процесс отказом',
    mustRedden: 'не ходит в базу, пока среда не названа',
    file: COMMAND,
    find: `  console.error(\`разбор отменён: \${(error as Error).message}\`)
  process.exit(1)`,
    replace: '  console.error(`разбор отменён: ${(error as Error).message}`)',
    tests: COMMAND_TESTS,
  },
]
