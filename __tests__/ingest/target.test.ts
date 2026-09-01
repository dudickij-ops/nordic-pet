import { Client } from 'pg'
import { describe, expect, it } from 'vitest'

import { projectDatabaseUrl } from '@/lib/db-url'
import {
  assertDriverReadsTheSameAddress,
  assertProductionDatabase,
  resolveIngestTarget,
} from '@/lib/ingest/target'

/**
 * Пароль в этих проверках — приметная строка, которую легко искать в тексте ошибки.
 * Ни одно сообщение об отказе не имеет права её содержать: ошибки загрузчика уходят
 * в журнал Vercel, а журнал — не место для пароля боевой базы.
 */
const PASSWORD = 'этого-пароля-в-выводе-быть-не-должно'

/** Годный боевой адрес: назван целиком, шифрование не отключено, хост не локальный. */
const PRODUCTION = `postgresql://ingester:${PASSWORD}@db.example.supabase.co:6543/postgres?sslmode=require`

/** Тот же адрес с одной испорченной частью. */
function broken(part: string, value: string): string {
  const url = new URL(PRODUCTION)
  if (part === 'sslmode') url.searchParams.set('sslmode', value)
  else if (part === 'host') url.hostname = value
  else if (part === 'port') url.port = value
  else if (part === 'database') url.pathname = value
  else if (part === 'user') url.username = value
  else if (part === 'password') url.password = value
  else throw new Error(`неизвестная часть адреса: ${part}`)
  return url.toString()
}

/** Текст ошибки, поднятой вызовом. Если вызов не упал — проверка обязана упасть здесь. */
function refusal(call: () => unknown): string {
  try {
    call()
  } catch (error) {
    return String(error)
  }
  throw new Error('вызов не отказал, хотя должен был')
}

describe('среда загрузчика называется словом', () => {
  it('без переменной отказывается работать и называет её', () => {
    const text = refusal(() => resolveIngestTarget({}))
    expect(text).toContain('NORDIC_PET_DB_TARGET')
    expect(text).toContain('local')
    expect(text).toContain('production')
  })

  // Молчаливого приведения нет: среда либо названа ровно, либо не названа.
  it.each(['', ' ', 'prod', 'LOCAL', 'Production', 'boy', 'true'])(
    'отказывается понимать значение «%s»',
    (value) => {
      expect(refusal(() => resolveIngestTarget({ NORDIC_PET_DB_TARGET: value }))).toContain(
        'NORDIC_PET_DB_TARGET',
      )
    },
  )

  it('local ведёт в ту же локальную базу, что и проверки', () => {
    const target = resolveIngestTarget({ NORDIC_PET_DB_TARGET: 'local' })
    expect(target.where).toBe('local')
    expect(target.url).toBe(projectDatabaseUrl())
    expect(target.url).toContain('nordic_pet')
  })

  it('local называет себя вслух', () => {
    const { label } = resolveIngestTarget({ NORDIC_PET_DB_TARGET: 'local' })
    expect(label).toContain('local')
    expect(label).toContain('nordic_pet')
  })

  it('production без адреса отказывается и называет переменную', () => {
    expect(refusal(() => resolveIngestTarget({ NORDIC_PET_DB_TARGET: 'production' }))).toContain(
      'SUPABASE_DB_URL',
    )
  })

  it('production с годным адресом отдаёт его как есть', () => {
    const target = resolveIngestTarget({
      NORDIC_PET_DB_TARGET: 'production',
      SUPABASE_DB_URL: PRODUCTION,
    })
    expect(target.where).toBe('production')
    expect(target.url).toBe(PRODUCTION)
  })

  it('production называет себя вслух хостом и базой, но не паролем', () => {
    const { label } = resolveIngestTarget({
      NORDIC_PET_DB_TARGET: 'production',
      SUPABASE_DB_URL: PRODUCTION,
    })
    expect(label).toContain('production')
    expect(label).toContain('db.example.supabase.co')
    expect(label).toContain('postgres')
    expect(label).not.toContain(PASSWORD)
  })

  /**
   * Настоящий путь: без единого аргумента, на настоящем окружении процесса.
   * Без этой проверки испытанным оказался бы только путь с подставленным окружением,
   * а в бою работает именно этот.
   */
  it('без аргументов читает окружение процесса', () => {
    const saved = process.env.NORDIC_PET_DB_TARGET
    try {
      process.env.NORDIC_PET_DB_TARGET = 'local'
      expect(resolveIngestTarget().url).toBe(projectDatabaseUrl())

      delete process.env.NORDIC_PET_DB_TARGET
      expect(refusal(() => resolveIngestTarget())).toContain('NORDIC_PET_DB_TARGET')
    } finally {
      if (saved === undefined) delete process.env.NORDIC_PET_DB_TARGET
      else process.env.NORDIC_PET_DB_TARGET = saved
    }
  })
})

describe('проверка боевого адреса', () => {
  it('пропускает адрес, названный целиком', () => {
    expect(assertProductionDatabase(PRODUCTION)).toBe(PRODUCTION)
  })

  // «Бой», указывающий на локальный хост, — это неверно названная среда, а не боевая база.
  it.each(['127.0.0.1', 'localhost', '[::1]'])('отвергает локальный хост %s', (host) => {
    expect(refusal(() => assertProductionDatabase(broken('host', host)))).toMatch(/локальн/i)
  })

  // Адрес идёт по публичной сети: отключённое шифрование — пароль открытым текстом.
  it('отвергает отключённое шифрование', () => {
    expect(refusal(() => assertProductionDatabase(broken('sslmode', 'disable')))).toContain(
      'sslmode',
    )
  })

  it('пропускает прочие значения sslmode', () => {
    expect(assertProductionDatabase(broken('sslmode', 'require'))).toContain('sslmode=require')
    expect(assertProductionDatabase(broken('sslmode', 'verify-full'))).toContain('verify-full')
  })

  // Адрес без sslmode драйвер соединяет без шифрования вовсе — проверено запуском:
  // parse(адрес без sslmode) даёт ssl undefined. Молчание здесь означает открытый текст.
  it('отвергает адрес, в котором шифрование не названо вовсе', () => {
    const withoutSslmode = new URL(PRODUCTION)
    withoutSslmode.searchParams.delete('sslmode')
    expect(refusal(() => assertProductionDatabase(withoutSslmode.toString()))).toContain('sslmode')
  })

  /**
   * Самое важное здесь. Разбор адреса драйвером и разбор адреса нами — два разных
   * разборщика, и у драйвера свои правила старшинства: параметры строки запроса он
   * кладёт ПОВЕРХ разобранного адреса. Проверено запуском на установленном pg:
   * адрес db.example.supabase.co:6543 с хвостом ?host=127.0.0.1&user=postgres
   * соединяет с 127.0.0.1 под пользователем postgres.
   *
   * Поэтому проверяется не наше представление об адресе, а то, что понял сам драйвер.
   */
  it.each([
    ['хост', 'host=127.0.0.1'],
    ['порт', 'port=5432'],
    ['пользователя', 'user=postgres'],
    ['путь поиска функций', 'options=-c%20search_path%3Dчужая'],
    ['имя базы по-другому', 'dbname=hospital'],
    ['файл службы', 'service=чужая'],
  ])('отвергает адрес с хвостом, задающим %s', (_name, tail) => {
    expect(() => assertProductionDatabase(`${PRODUCTION}&${tail}`)).toThrow()
  })

  // Часть этих хвостов драйвер сегодня не читает — проверено запуском, `dbname` и
  // `service` он игнорирует. Отвергаются они всё равно: правило здесь — список
  // разрешённого, а не перечень обходов, известных на сегодня.
  it('отвергает даже безобидный на вид хвост', () => {
    expect(refusal(() => assertProductionDatabase(`${PRODUCTION}&application_name=я`))).toContain(
      'application_name',
    )
  })

  it('у пропущенного адреса драйвер видит ровно то, что мы проверили', () => {
    const seen = new Client({ connectionString: assertProductionDatabase(PRODUCTION) })
    expect(seen.host).toBe('db.example.supabase.co')
    expect(String(seen.port)).toBe('6543')
    expect(seen.user).toBe('ingester')
    expect(seen.database).toBe('postgres')
    expect(seen.password).toBe(PASSWORD)
    expect(seen.ssl).toBeTruthy()
  })

  // Отказ именно за неназванное шифрование, а не за что-нибудь ещё по дороге:
  // иначе снятие этой проверки осталось бы незамеченным.
  it('отказ за неназванный sslmode говорит именно об этом', () => {
    const withoutSslmode = new URL(PRODUCTION)
    withoutSslmode.searchParams.delete('sslmode')
    expect(refusal(() => assertProductionDatabase(withoutSslmode.toString()))).toContain(
      'не назван sslmode',
    )
  })

  // Текст после решётки наш разборщик отрезает, а драйвер читает — проверено запуском:
  // спрятанный там sslmode=disable даёт соединение без шифрования.
  it('отвергает отключение шифрования, спрятанное после решётки', () => {
    const hidden = `postgresql://ingester:${PASSWORD}@db.example.supabase.co:6543/postgres#?sslmode=disable`
    expect(() => assertProductionDatabase(hidden)).toThrow()
  })

  it('пароль со знаками, требующими перекодировки, доезжает до драйвера целым', () => {
    const tricky = 'p@ss:word/сложный%20'
    const url = new URL(PRODUCTION)
    url.password = encodeURIComponent(tricky)
    const seen = new Client({ connectionString: assertProductionDatabase(url.toString()) })
    expect(seen.password).toBe(tricky)
    expect(seen.host).toBe('db.example.supabase.co')
  })

  /**
   * Каждая часть обязана быть названа в адресе. Драйвер pg дочитывает недостающее из
   * переменных PG*, как libpq: проверено опытом на живой базе — адрес без имени базы
   * увёл соединение в базу из PGDATABASE. Проверенным оказался бы один адрес,
   * а запись ушла бы в другую базу.
   */
  it.each([
    ['порт', 'port', ''],
    ['имя базы', 'database', '/'],
    ['пользователя', 'user', ''],
    ['пароль', 'password', ''],
  ])('отвергает адрес, в котором не назван %s', (_name, part, value) => {
    expect(() => assertProductionDatabase(broken(part, value))).toThrow()
  })

  it('отвергает не тот вид адреса', () => {
    expect(() => assertProductionDatabase('https://db.example.supabase.co/postgres')).toThrow()
    expect(() => assertProductionDatabase('вообще не адрес')).toThrow()
  })

  it.each([
    ['локальный хост', () => broken('host', '127.0.0.1')],
    ['отключённое шифрование', () => broken('sslmode', 'disable')],
    ['неназванный порт', () => broken('port', '')],
    ['неназванное имя базы', () => broken('database', '/')],
    ['неназванного пользователя', () => broken('user', '')],
    ['неразбираемый адрес', () => `постгрес://ingester:${PASSWORD}@хост/база`],
  ])('не показывает пароль, отказывая за %s', (_name, make) => {
    expect(refusal(() => assertProductionDatabase(make()))).not.toContain(PASSWORD)
  })
})

/**
 * Сверка с драйвером проверяется отдельно от всего остального.
 *
 * Иначе её нельзя доказать: сегодня каждый известный способ подмены отсекается раньше —
 * списком разрешённых параметров и требованием назвать sslmode. Эта сверка стоит на
 * случай способа, которого мы ещё не знаем, и такой способ по определению не изобразить
 * в проверке. Поэтому проверяется сам механизм сверки, а не путь до него.
 */
describe('сверка с тем, что понял драйвер', () => {
  const ADDRESS = `postgresql://ingester:${PASSWORD}@db.example.supabase.co:6543/postgres?sslmode=require`
  const CORRECT = {
    host: 'db.example.supabase.co',
    port: '6543',
    database: 'postgres',
    user: 'ingester',
  }

  it('молчит, когда оба прочтения сошлись', () => {
    expect(() => assertDriverReadsTheSameAddress(ADDRESS, CORRECT)).not.toThrow()
  })

  it.each([
    ['хост', { host: 'db.other.supabase.co' }],
    ['порт', { port: '5432' }],
    ['базу', { database: 'hospital' }],
    ['пользователя', { user: 'postgres' }],
  ])('отвергает расхождение в части «%s»', (part, difference) => {
    const text = refusal(() =>
      assertDriverReadsTheSameAddress(ADDRESS, { ...CORRECT, ...difference }),
    )
    expect(text).toContain(part)
    expect(text).not.toContain(PASSWORD)
  })

  it('отвергает адрес, который драйвер понял как соединение без шифрования', () => {
    const hidden = `postgresql://ingester:${PASSWORD}@db.example.supabase.co:6543/postgres#?sslmode=disable`
    expect(refusal(() => assertDriverReadsTheSameAddress(hidden, CORRECT))).toContain('шифрован')
  })
})
