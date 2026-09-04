import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'

import { DATABASE_COMMANDS, withRealCalls } from '@/lib/commands'
import { refreshEverything } from '@/lib/metrics/refresh'
import { refreshAction } from '@/app/refresh-action'
import { RefreshView } from '@/app/refresh-panel'
import HomePage from '@/app/page'
import { blockNetwork } from '../commands/network'

/**
 * Проверки задачи 8: кнопка «Обновить данные», щель между загрузкой и разбором, и
 * обязательства пути кнопки.
 *
 * Ни базы, ни сети первые шесть проверок не трогают: `refreshEverything()` зовётся с
 * подставками либо трёх шагов напрямую, либо списка команд. Последние две проверки —
 * единственные, где идёт настоящая работа: серверное действие кнопки зовётся без единой
 * подставки на перекрытой сети, чтобы доказать, что своей дороги наружу у кнопки нет.
 *
 * Проверка «второе нажатие подряд ничего не меняет» ходит в Google по-настоящему —
 * она в живом наборе, `__tests__/live/refresh.live.ts`, а не здесь.
 */

/**
 * Обвязка S6, добавленная с разрешения владельца. Страница отчёта и серверное действие
 * кнопки закрыты сторожем доступа, а сторож читает cookie из запроса Next — вне запроса
 * чтение отказывает, и прямой вызов, каким он написан ниже, до работы бы не дошёл.
 *
 * Здесь изображается **запрос с годной cookie**: подставляется окружение вокруг вызова, а
 * не сам сторож — он остаётся настоящим и продолжает работать. Ни одно утверждение этого
 * файла не тронуто; что они уцелели, доказано прогоном прежних сломов S5 по именам —
 * вывод в теле pull request.
 *
 * Секрет и cookie заведомо ненастоящие: настоящие придумывает владелец и кладёт в
 * переменные проекта.
 */
const СЕКРЕТ_ПРОВЕРКИ = 'не-настоящий-секрет-подписи-для-проверок-0123456789'
process.env.NORDIC_PET_SESSION_SECRET = СЕКРЕТ_ПРОВЕРКИ

vi.mock('next/headers', () => ({
  cookies: async () => {
    // Ввоз внутри, а не наверху файла: подставки поднимаются выше любых ввозов, и величина
    // из тела файла на момент первого срабатывания подставки ещё не существует.
    const { начеканить, SESSION_COOKIE } = await import('@/lib/auth/session')
    const годная = начеканить(Date.now(), СЕКРЕТ_ПРОВЕРКИ).value
    return {
      get: (имя: string) => (имя === SESSION_COOKIE ? { name: имя, value: годная } : undefined),
    }
  },
}))


/** Задаёт локальную цель на время тела и возвращает окружение как было. */
async function withLocalTarget(run: () => Promise<void> | void): Promise<void> {
  const saved = process.env.NORDIC_PET_DB_TARGET
  process.env.NORDIC_PET_DB_TARGET = 'local'
  try {
    await run()
  } finally {
    if (saved === undefined) delete process.env.NORDIC_PET_DB_TARGET
    else process.env.NORDIC_PET_DB_TARGET = saved
  }
}

/**
 * Поддельный ключ служебного аккаунта — ровно той формы, которую понимает
 * `google-auth-library`, чтобы код Таблицы дошёл до попытки сходить в сеть за токеном
 * (`oauth2.googleapis.com`), а не остановился раньше самим устройством клиента —
 * например, поиском ключа по умолчанию через метаданные облака, у которых свой адрес,
 * не содержащий `googleapis.com`.
 *
 * Настоящий секрет здесь не нужен и не используется: до проверки подписи ключа дело не
 * доходит вовсе — перекрытая сеть останавливает работу первым же стуком, раньше, чем
 * Google успел бы прочитать хоть один байт запроса.
 */
function fakeServiceAccountKeyPath(): string {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  })
  const dir = mkdtempSync(join(tmpdir(), 'nordic-pet-fake-key-'))
  const path = join(dir, 'fake-service-account.json')
  writeFileSync(
    path,
    JSON.stringify({
      type: 'service_account',
      project_id: 'nordic-pet-test',
      private_key_id: 'test',
      private_key: privateKey,
      client_email: 'test@nordic-pet-test.iam.gserviceaccount.com',
      client_id: 'test',
      token_uri: 'https://oauth2.googleapis.com/token',
    }),
  )
  return path
}

/** Собирает подставки трёх шагов и ленту того, что вправду позвали. */
function шагиС(отказНа?: 'ingest:sheets' | 'ingest:ads' | 'facts', причина = 'нарочно') {
  const лента: string[] = []
  const шаг = (имя: 'ingest:sheets' | 'ingest:ads' | 'facts') => async () => {
    лента.push(имя)
    if (имя === отказНа) throw new Error(причина)
  }
  return {
    лента,
    deps: {
      announce: () => {},
      ingestSheets: шаг('ingest:sheets'),
      ingestAds: шаг('ingest:ads'),
      buildFacts: шаг('facts'),
    },
  }
}

test('порядок шагов: Таблица, папка, разбор', async () => {
  const { лента, deps } = шагиС()
  await refreshEverything(deps)
  expect(лента).toEqual(['ingest:sheets', 'ingest:ads', 'facts'])
})

test('отказ загрузки Таблицы называет свой шаг, щели не объявляет и до разбора не доходит', async () => {
  // Записать никто не успел, значит числа на экране верны своему сырью: щели нет.
  const { лента, deps } = шагиС('ingest:sheets')
  const итог = await refreshEverything(deps)
  expect(итог).toMatchObject({ ok: false, step: 'Таблица', stale: false })
  expect(лента).toEqual(['ingest:sheets'])
})

test('отказ загрузки папки называет свой шаг и объявляет щель', async () => {
  // Щель есть тогда, когда хоть один шаг успел записать. К отказу папки Таблица уже
  // записана своей транзакцией: сырьё наполовину новое, факты вчерашние.
  const { лента, deps } = шагиС('ingest:ads')
  const итог = await refreshEverything(deps)
  expect(итог).toMatchObject({ ok: false, step: 'папка', stale: true })
  expect(лента).toEqual(['ingest:sheets', 'ingest:ads'])
})

test('отказ разбора после удачных загрузок называет щель', async () => {
  const { deps } = шагиС('facts')
  const итог = await refreshEverything(deps)
  expect(итог).toMatchObject({ ok: false, step: 'разбор', stale: true })
  expect(итог.ok).toBe(false)
  if (итог.ok) return
  expect(итог.text).toMatch(/источники перечитаны/i)
  expect(итог.text).toMatch(/прежн|устарел/i)
})

test('текст отказа несёт причину, а не только шаг', async () => {
  const { deps } = шагиС('facts', 'курса на 2026-03-07 нет')
  const итог = await refreshEverything(deps)
  expect(итог.ok).toBe(false)
  if (итог.ok) return
  expect(итог.text).toContain('курса на 2026-03-07 нет')
})

test('запись команды без боевого вызова — отказ, называющий имя', () => {
  // Словарь боевых вызовов по строковому ключу молча отдаёт пустоту на незнакомом имени,
  // а тип обещает функцию. Задача 9 добавляет в этот же список команду метрик — и её
  // боевой вызов оказался бы пустотой при зелёном наборе и чистых типах.
  expect(() =>
    withRealCalls([
      { name: 'нет-такой', script: 's.ts', refusal: 'x', outsideWorld: [], run: async () => {} },
    ]),
  ).toThrow(/нет-такой/)
})

test('кнопка зовёт только работы из списка команд, и все три', async () => {
  const позвано: string[] = []
  const список = DATABASE_COMMANDS.map((команда) => ({
    ...команда,
    real: async () => {
      позвано.push(команда.name)
    },
  }))
  await refreshEverything({ announce: () => {}, commands: список })
  expect(позвано).toEqual(['ingest:sheets', 'ingest:ads', 'facts'])
})

test('шага, которого нет в списке команд, кнопка не выдумывает', async () => {
  const без = DATABASE_COMMANDS.filter((команда) => команда.name !== 'facts')
  await expect(
    refreshEverything({ announce: () => {}, commands: без }),
  ).rejects.toThrow(/нет в списке/)
})

test('серверное действие кнопки за работу стучится только в Google', async () => {
  await withLocalTarget(async () => {
    // GOOGLE_SHEETS_SPREADSHEET_ID и GOOGLE_APPLICATION_CREDENTIALS обязаны быть
    // названы, иначе загрузчик откажет до всякой попытки сходить наружу — и «стуков
    // нет» не доказало бы ничего. Значения — не настоящие: до Google дело не доходит.
    const savedId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID
    const savedCredentials = process.env.GOOGLE_APPLICATION_CREDENTIALS
    const fakeKeyPath = fakeServiceAccountKeyPath()
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID = 'проверка-не-настоящая-таблица'
    process.env.GOOGLE_APPLICATION_CREDENTIALS = fakeKeyPath

    try {
      const сеть = blockNetwork({ allowLocalDatabase: true })
      // Без этого «стуков нет» не значило бы ничего: ловушка обязана доказать себя первой.
      сеть.proveTrapWorks()
      try {
        // Действие зовётся по-настоящему, без единой подставки: подставка проверяла бы шов.
        const итог = await refreshAction()
        expect(итог).toMatchObject({ ok: false, step: 'Таблица' })
        expect(итог.ok).toBe(false)
        if (итог.ok) return
        // Отказ читаемый, а не необработанное падение перекрытой сети.
        expect(итог.text).toMatch(/загрузк/i)
      } finally {
        сеть.restore()
      }
      expect(сеть.knocks.length).toBeGreaterThan(0)
      expect(сеть.knocks.filter((стук) => !/googleapis\.com/.test(стук))).toEqual([])
    } finally {
      if (savedId === undefined) delete process.env.GOOGLE_SHEETS_SPREADSHEET_ID
      else process.env.GOOGLE_SHEETS_SPREADSHEET_ID = savedId
      if (savedCredentials === undefined) delete process.env.GOOGLE_APPLICATION_CREDENTIALS
      else process.env.GOOGLE_APPLICATION_CREDENTIALS = savedCredentials
      // Поддельный ключ жил только ради этой проверки — временный каталог за собой убираем.
      rmSync(dirname(fakeKeyPath), { recursive: true, force: true })
    }
  })
})

test('шаги кнопки не объявляют себе внешних миров сверх Google', () => {
  const миры = new Set(
    ['ingest:sheets', 'ingest:ads', 'facts']
      .map((имя) => DATABASE_COMMANDS.find((к) => к.name === имя)!)
      .flatMap((команда) => команда.outsideWorld),
  )
  expect([...миры]).toEqual(['google'])
})

/**
 * Проверки круга правок 1: пометка устаревания — половина требования контракта, которую
 * первая редакция не сторожила ничем. `RefreshView` — чистый компонент без единого хука,
 * поэтому его можно отрисовать статической разметкой без клиентского окружения.
 */

test('при удаче вид не помечен устаревшим и отказа не печатает', () => {
  const html = renderToStaticMarkup(
    <RefreshView outcome={{ ok: true }} pending={false}>
      <p>ЧИСЛА</p>
    </RefreshView>,
  )
  expect(html).toContain('ЧИСЛА')
  expect(html).toContain('data-stale="false"')
  expect(html).not.toContain('устарел')
})

test('отказ без щели: текст есть, вид чисел прежний', () => {
  const html = renderToStaticMarkup(
    <RefreshView
      outcome={{ ok: false, step: 'Таблица', text: 'ключ не подошёл', stale: false }}
      pending={false}
    >
      <p>ЧИСЛА</p>
    </RefreshView>,
  )
  expect(html).toContain('Таблица')
  expect(html).toContain('ключ не подошёл')
  expect(html).toContain('data-stale="false"')
})

test('отказ со щелью: и текст, и изменённый вид чисел', () => {
  const html = renderToStaticMarkup(
    <RefreshView
      outcome={{ ok: false, step: 'разбор', text: 'источники перечитаны, разбор отказал', stale: true }}
      pending={false}
    >
      <p>ЧИСЛА</p>
    </RefreshView>,
  )
  expect(html).toContain('разбор')
  expect(html).toContain('data-stale="true"')
  expect(html).toContain('устарел') // пометка видна без чтения текста отказа
  expect(html).toContain('ЧИСЛА') // числа не пропадают, а меняют вид
})

/**
 * Проверка круга правок 2: кнопку на экран ставит эта задача. `HomePage` бьёт в местную
 * базу по-настоящему через `monthlyReport()`, поэтому цель называется явно, тем же
 * приёмом, что и у остальных проверок этого файла.
 */
test('экран содержит кнопку и оборачивает ею отчёт', async () => {
  await withLocalTarget(async () => {
    const html = renderToStaticMarkup(await HomePage({ searchParams: Promise.resolve({}) }))
    expect(html).toContain('Обновить данные')
    expect(html).toContain('data-stale=')
  })
})
