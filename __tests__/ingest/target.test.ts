import { Client } from 'pg'
import { describe, expect, it } from 'vitest'

import { projectDatabaseUrl } from '@/lib/db-url'
import { productionConnection, resolveIngestTarget } from '@/lib/ingest/target'

/**
 * Пароль в этих проверках — приметная строка, которую легко искать в тексте ошибки.
 * Ни одно сообщение об отказе не имеет права её содержать: ошибки загрузчика уходят
 * в журнал Vercel, а журнал — не место для пароля боевой базы.
 */
const PASSWORD = 'этого-пароля-в-выводе-быть-не-должно'

/** Годный боевой адрес: назван целиком, хост не локальный. */
const PRODUCTION = `postgresql://ingester:${PASSWORD}@db.example.supabase.co:6543/postgres`

const ENV = { NORDIC_PET_DB_TARGET: 'production', SUPABASE_DB_URL: PRODUCTION }

/** Тот же адрес с одной испорченной частью. */
function broken(part: string, value: string): string {
  const url = new URL(PRODUCTION)
  if (part === 'host') url.hostname = value
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
    expect(target.connection).toBe(projectDatabaseUrl())
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

  it('production отдаёт разобранные поля, а не строку', () => {
    const target = resolveIngestTarget(ENV)
    expect(target.where).toBe('production')
    expect(typeof target.connection).toBe('object')
  })

  it('production называет себя вслух хостом и базой, но не паролем', () => {
    const { label } = resolveIngestTarget(ENV)
    expect(label).toContain('production')
    expect(label).toContain('db.example.supabase.co')
    expect(label).toContain('postgres')
    expect(label).not.toContain(PASSWORD)
  })

  it('без аргументов читает окружение процесса', () => {
    const saved = process.env.NORDIC_PET_DB_TARGET
    try {
      process.env.NORDIC_PET_DB_TARGET = 'local'
      expect(resolveIngestTarget().connection).toBe(projectDatabaseUrl())

      delete process.env.NORDIC_PET_DB_TARGET
      expect(refusal(() => resolveIngestTarget())).toContain('NORDIC_PET_DB_TARGET')
    } finally {
      if (saved === undefined) delete process.env.NORDIC_PET_DB_TARGET
      else process.env.NORDIC_PET_DB_TARGET = saved
    }
  })
})

describe('боевой адрес разбирается на поля', () => {
  /**
   * Шесть полей передаются драйверу явно, и каждое проверяется отдельно: тогда потеря
   * любого из них краснеет своей проверкой, а не тонет в общей.
   *
   * Проверяется не наше представление о полях, а то, что из них собрал сам драйвер.
   */
  const built = () => new Client(productionConnection(PRODUCTION, {}))

  it('хост передан явно', () => {
    expect(built().host).toBe('db.example.supabase.co')
  })

  it('порт передан явно и числом', () => {
    expect(built().port).toBe(6543)
  })

  it('пользователь передан явно', () => {
    expect(built().user).toBe('ingester')
  })

  it('пароль передан явно и целым', () => {
    expect(built().password).toBe(PASSWORD)
  })

  it('база передана явно', () => {
    expect(built().database).toBe('postgres')
  })

  it('шифрование передано явно и с проверкой сертификата', () => {
    expect(built().ssl).toMatchObject({ rejectUnauthorized: true })
  })

  it('пароль со знаками, требующими перекодировки, доезжает целым', () => {
    const tricky = 'p@ss:word/сложный%20&='
    const url = new URL(PRODUCTION)
    url.password = encodeURIComponent(tricky)
    expect(new Client(productionConnection(url.toString(), {})).password).toBe(tricky)
  })

  // Драйвер с битой перекодировкой справляется, берёт имя буквально. Наш разбор не имеет
  // права падать сырым URIError там, где драйвер работает.
  it('пользователь с одиночным процентом не роняет разбор', () => {
    const url = `postgresql://100%:${PASSWORD}@db.example.supabase.co:6543/postgres`
    expect(productionConnection(url, {}).user).toBe('100%')
  })
})

describe('строка запроса выбрасывается целиком', () => {
  /**
   * Разбор адреса нами и разбор адреса драйвером — два разных разборщика с разными
   * правилами старшинства: параметры строки запроса драйвер клал ПОВЕРХ разобранного
   * адреса, и проверенный адрес расходился с адресом соединения. Проверять хвост
   * перечнем разрешённого — заплата; выбросить его целиком — снятая проблема.
   */
  it.each([
    ['подмена хоста', 'host=127.0.0.1'],
    ['подмена порта', 'port=5432'],
    ['подмена пользователя', 'user=postgres'],
    ['подмена пути поиска функций', 'options=-c%20search_path%3Dчужая'],
    ['отключение шифрования', 'sslmode=disable'],
    ['файл службы', 'service=чужая'],
  ])('%s из хвоста не доезжает до драйвера', (_name, tail) => {
    const client = new Client(productionConnection(`${PRODUCTION}?${tail}`, {}))
    expect(client.host).toBe('db.example.supabase.co')
    expect(client.port).toBe(6543)
    expect(client.user).toBe('ingester')
    expect(client.database).toBe('postgres')
    expect(client.ssl).toMatchObject({ rejectUnauthorized: true })
    // Отдельно: путь поиска функций. Именно он решает, какая функция отзовётся на
    // raw.replace_orders, и смотреть на него надо прямо, а не через прочие поля.
    // Поле настроек в типах драйвера не объявлено, поэтому читается приведением —
    // названо вслух; при переименовании проверка покраснеет, а не позеленеет молча.
    const settings = (client as unknown as { connectionParameters?: { options?: string } })
      .connectionParameters
    expect(settings, 'драйвер больше не хранит настройки в connectionParameters').toBeDefined()
    expect(settings?.options).toBeUndefined()
  })

  it('текст после решётки тоже не доезжает', () => {
    const client = new Client(productionConnection(`${PRODUCTION}#?sslmode=disable`, {}))
    expect(client.database).toBe('postgres')
    expect(client.ssl).toMatchObject({ rejectUnauthorized: true })
  })
})

describe('чего боевой адрес не может', () => {
  it.each(['127.0.0.1', 'localhost', '[::1]'])('не может указывать на локальный хост %s', (host) => {
    expect(refusal(() => productionConnection(broken('host', host), {}))).toMatch(/локальн/i)
  })

  // Перекодированная запись того же локального адреса. Отказ обязан прийти от нас и
  // назвать причину, а не от службы имён, которая просто не найдёт такого хоста.
  it('не может указывать на локальный хост в перекодированной записи', () => {
    const url = `postgresql://ingester:${PASSWORD}@%31%32%37.0.0.1:6543/postgres`
    expect(refusal(() => productionConnection(url, {}))).toMatch(/локальн/i)
  })

  /**
   * Хост проверяется положительно: он обязан выглядеть именем в сети. Перечень
   * запрещённых написаний не поспевал дважды — сначала перекодированная запись, потом
   * путь к сокету, — а написаний локального адреса больше, чем можно перечислить.
   *
   * Путь к сокету особенно важен: хост, начинающийся с косой черты, драйвер считает не
   * именем в сети, а путём к сокету на этой же машине — проверено запуском. То есть
   * «бой» соединился бы с базой на машине разработчика.
   */
  it.each([
    ['путь к сокету', '%2Fvar%2Frun%2Fpostgresql'],
    ['путь к сокету с точкой в имени', '%2Fvar%2Frun%2Fpg.sock'],
    ['путь к сокету рядом', '.%2F%2E%2Epostgres.sock'],
    ['localhost', 'localhost'],
    ['LOCALHOST заглавными', 'LOCALHOST'],
    ['короткая запись петли', '127.1'],
    ['петля числом', '2130706433'],
    ['петля шестнадцатерично', '0x7f.0.0.1'],
    ['петля с нулями', '127.000.000.001'],
    ['петля с точкой на конце', '127.0.0.1.'],
    ['любой адрес', '0.0.0.0'],
    ['адрес вместо имени', '203.0.113.7'],
  ])('не принимает хост «%s»: это не имя в сети', (_name, host) => {
    const url = `postgresql://ingester:${PASSWORD}@${host}:6543/postgres`
    // Сверяется текст, а не голое «упало»: голое «упало» зеленело бы и от постороннего
    // отказа — скажем, от неназванного порта, — и проверка перестала бы стеречь своё.
    expect(refusal(() => productionConnection(url, {}))).toMatch(/локальн|именем в сети/i)
  })

  it.each([
    'db.example.supabase.co',
    'aws-0-eu-central-1.pooler.supabase.com',
    'db-1.example.com',
    // Полное имя с точкой на конце: служба имён и драйвер такое принимают, и человек,
    // скопировавший имя из настроек службы имён, напишет именно так.
    'db.example.supabase.co.',
  ])('принимает боевое имя %s', (host) => {
    const url = `postgresql://ingester:${PASSWORD}@${host}:6543/postgres`
    expect(productionConnection(url, {}).host).toBe(host)
  })

  it.each([
    ['порт', 'port', ''],
    ['имя базы', 'database', '/'],
    ['пользователя', 'user', ''],
    ['пароль', 'password', ''],
  ])('не может не называть %s', (_name, part, value) => {
    expect(() => productionConnection(broken(part, value), {})).toThrow()
  })

  it('не может быть другого вида', () => {
    expect(() => productionConnection('https://db.example.supabase.co/postgres', {})).toThrow()
    expect(() => productionConnection('вообще не адрес', {})).toThrow()
  })

  it.each([
    ['локальный хост', () => broken('host', '127.0.0.1')],
    ['неназванный порт', () => broken('port', '')],
    ['неназванное имя базы', () => broken('database', '/')],
    ['неназванного пользователя', () => broken('user', '')],
    ['неразбираемый адрес', () => `постгрес://ingester:${PASSWORD}@хост/база`],
  ])('не показывает пароль, отказывая за %s', (_name, make) => {
    expect(refusal(() => productionConnection(make(), {}))).not.toContain(PASSWORD)
  })
})

describe('корневой сертификат', () => {
  /**
   * Сертификат боевой базы может оказаться подписан своей корневой, а не публично
   * доверенной. Тогда его подкладывают переменной окружения — без единой строки кода.
   */
  it('подложенная корневая уезжает драйверу вместе с проверкой сертификата', () => {
    const ca = '-----BEGIN CERTIFICATE-----\nвыдуманная\n-----END CERTIFICATE-----'
    const connection = productionConnection(PRODUCTION, { SUPABASE_DB_CA: ca })
    expect(connection.ssl).toEqual({ rejectUnauthorized: true, ca })
  })

  it('без переменной проверка сертификата идёт по доверенным корневым системы', () => {
    expect(productionConnection(PRODUCTION, {}).ssl).toEqual({ rejectUnauthorized: true })
  })
})
