import { describe, expect, it } from 'vitest'

import { projectDatabaseUrl } from '@/lib/db-url'
import { assertProductionDatabase, resolveIngestTarget } from '@/lib/ingest/target'

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

  it('пропускает прочие значения sslmode и адрес без него', () => {
    expect(assertProductionDatabase(broken('sslmode', 'require'))).toContain('sslmode=require')
    const withoutSslmode = new URL(PRODUCTION)
    withoutSslmode.searchParams.delete('sslmode')
    expect(assertProductionDatabase(withoutSslmode.toString())).toContain('supabase.co')
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
