import { ingestAdsFolder } from './ingest/load-ads.ts'
import { ingestSheets } from './ingest/load-sheets.ts'
import { buildFacts } from './facts/build.ts'

/**
 * Список команд, ходящих в базу, и их обязательств.
 *
 * Зачем список. Одни и те же обязательства забывались дважды подряд: снятие переменных
 * `PG*`, называние цели до работы, запуск простым `node`. Каждый раз они были записаны
 * прозой в правилах и каждый раз всплывали находкой рецензента. Проза не проверяется;
 * список — проверяется, и новая команда проходит проверки самим фактом того, что она здесь.
 *
 * Внешний мир объявляется тут же и данными. Не «у разбора сети нет, а у загрузок есть» —
 * это исключение из правила, которое однажды забудут, — а строка в записи: команда не ходит
 * никуда, кроме названного. Следующая команда объявит свой мир или покраснеет.
 */

/** Соединение в том малом, что нужно проверке обязательств. */
export type ProbeClient = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>
  release: () => Promise<void>
}

/**
 * Зацепки, с которыми команду зовут проверки обязательств.
 *
 * Ни базы, ни сети за ними нет: `connect` записывает момент и обрывает работу, `outside`
 * отдаёт заранее заготовленный ответ вместо похода наружу. Проверяется порядок событий,
 * а не то, что команда доработала до конца.
 */
export type Probes = {
  /** Лента событий по порядку: `цель`, `внешний мир: …`, `соединение`. */
  timeline: string[]
  announce: (line: string) => void
  connect: () => Promise<ProbeClient>
  outside: <T>(world: string, answer: T) => T
}

export type DatabaseCommand = {
  /** Как команда зовётся в `package.json`. */
  name: string
  /** Путь к сценарию — его запускают простым `node`. */
  script: string
  /** Слово, которым команда объявляет отказ человеку. */
  refusal: string
  /**
   * Куда команде законно ходить наружу. Пусто — значит никуда.
   *
   * Проверяется наблюдением: на время проверки выход наружу перекрыт, объявленный мир
   * подменён заготовленным ответом, и сверяется, за какими мирами команда вправду
   * сходила. Разбором списка импортов это не проверяется и не может: реэкспорт,
   * динамический импорт и голый `fetch` он не видит.
   */
  outsideWorld: string[]
  /** Позвать работу команды с зацепками вместо базы и внешнего мира. */
  run: (probes: Probes) => Promise<unknown>
}

/** Заголовок и одна строка данных — ровно столько, чтобы разбор дошёл до соединения. */
const SHEET_FIXTURE: Record<string, string[][]> = {
  orders: [
    ['date', 'order_id', 'sku', 'units', 'gross_eur', 'discount_eur', 'gateway'],
    ['2026-03-01', 'NP1001', 'NP-001', '1', '10.00', '0.00', 'card'],
  ],
  refunds: [
    ['refund_date', 'order_id', 'sku', 'units', 'amount_eur'],
    ['2026-03-05', 'NP1001', 'NP-001', '1', '10.00'],
  ],
  costs: [['sku', 'cost_eur', 'valid_from'], ['NP-001', '5.10', '2026-01-01']],
  fees: [['gateway', 'percent', 'fixed_eur'], ['card', '1.9', '0.25']],
  opex: [['month', 'category', 'amount_eur'], ['2026-03', 'rent', '950,00']],
  fx: [['date', 'usd_per_eur'], ['2026-03-01', '1.05']],
}

const ADS_FIXTURE = {
  files: [
    {
      name: 'meta_2026-03.csv',
      bytes: new TextEncoder().encode('date,campaign,spend_usd\n2026-03-01,Broad EU,12.40\n'),
    },
  ],
  skipped: [],
}

export const DATABASE_COMMANDS: DatabaseCommand[] = [
  {
    name: 'ingest:sheets',
    script: 'scripts/ingest-sheets.ts',
    refusal: 'загрузка отменена',
    outsideWorld: ['google'],
    run: (probes) =>
      ingestSheets({
        announce: probes.announce,
        connect: probes.connect,
        readSpreadsheet: async () => probes.outside('google', SHEET_FIXTURE),
      }),
  },
  {
    name: 'ingest:ads',
    script: 'scripts/ingest-ads.ts',
    refusal: 'загрузка отменена',
    outsideWorld: ['google'],
    run: (probes) =>
      ingestAdsFolder({
        announce: probes.announce,
        connect: probes.connect,
        readFolder: async () => probes.outside('google', ADS_FIXTURE),
      }),
  },
  {
    name: 'facts',
    script: 'scripts/build-facts.ts',
    refusal: 'разбор отменён',
    outsideWorld: [],
    run: (probes) => buildFacts({ announce: probes.announce, connect: probes.connect }),
  },
]

/**
 * Сценарии, которые командами дашборда не являются, и почему.
 *
 * Перечень нужен затем, что без него список команд — тот же забываемый чек-лист: новая
 * команда просто не попала бы в него, и обязательства снова остались бы непроверенными.
 * Дописать сюда строку можно, но она видна в диффе и требует причины.
 */
export const NOT_A_COMMAND: Record<string, string> = {
  'scripts/db-reset.ts': 'пересоздание местной базы, а не команда дашборда: в бой не ходит',
  'scripts/run-breaks.ts': 'инструмент разработчика: правит файлы в рабочем дереве',
}
