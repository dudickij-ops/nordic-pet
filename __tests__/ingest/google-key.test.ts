import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { googleAuth } from '@/lib/ingest/google-access'

/**
 * Ключ служебного аккаунта двумя способами: значением переменной и файлом по пути.
 *
 * Второй способ появился потому, что на Vercel файла нет и положить его некуда: путь к
 * файлу там некуда указать, и кнопка «Обновить данные» в бою до Google не дошла бы вовсе.
 *
 * До Google дело здесь не доходит ни разу — проверяется только то, каким ключом
 * подписывался бы запрос. Пара ключей поддельная и рождается на месте, как в принятой
 * проверке S5: настоящих секретов в проверках нет и быть не должно.
 */

const ОБЛАСТЬ = 'https://www.googleapis.com/auth/drive.readonly'

/** Имя переменной, из которой библиотека читает путь к файлу ключа. */
const ПУТЬ_К_ФАЙЛУ = 'GOOGLE_APPLICATION_CREDENTIALS'

/**
 * Одна поддельная пара на весь файл: рождение пары стоит заметного времени, а проверкам
 * важен не сам ключ, а то, чей ключ выбран, — поэтому пара общая, а почта разная.
 */
const { privateKey: ПОДДЕЛЬНЫЙ_КЛЮЧ } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})

/** Поддельный ключ служебного аккаунта — те же поля, что у настоящего. */
function поддельныйКлюч(email: string): Record<string, string> {
  return {
    type: 'service_account',
    project_id: 'nordic-pet-test',
    private_key_id: 'test',
    private_key: ПОДДЕЛЬНЫЙ_КЛЮЧ,
    client_email: email,
    client_id: 'test',
    token_uri: 'https://oauth2.googleapis.com/token',
  }
}

/** Ключ значением: содержимое файла целиком, строкой. */
function ключЗначением(email: string): string {
  return JSON.stringify(поддельныйКлюч(email))
}

/** Временные каталоги поддельных ключей — убираются после каждой проверки. */
const каталоги: string[] = []

/** Ключ файлом: кладёт поддельный ключ во временный каталог и отдаёт путь. */
function ключФайлом(email: string): string {
  const каталог = mkdtempSync(join(tmpdir(), 'nordic-pet-fake-key-'))
  каталоги.push(каталог)
  const путь = join(каталог, 'fake-service-account.json')
  writeFileSync(путь, JSON.stringify(поддельныйКлюч(email)))
  return путь
}

/**
 * Ловушка, из-за которой второй способ нельзя проверить одним доводом: путь к файлу
 * библиотека читает из настоящего `process.env`, а не из нашего довода. Значит на время
 * проверки настоящая переменная вправду задаётся — и проверка вправду доходит до чтения
 * файла с диска, а не изображает это. После проверки окружение возвращается как было.
 */
async function сНастоящимПутём<Т>(путь: string, тело: () => Promise<Т>): Promise<Т> {
  const было = process.env[ПУТЬ_К_ФАЙЛУ]
  process.env[ПУТЬ_К_ФАЙЛУ] = путь
  try {
    return await тело()
  } finally {
    if (было === undefined) delete process.env[ПУТЬ_К_ФАЙЛУ]
    else process.env[ПУТЬ_К_ФАЙЛУ] = было
  }
}

/** Почта служебного аккаунта, которой клиент подписывал бы запрос. */
function почтаКлиента(клиент: unknown): string | undefined {
  return (клиент as { email?: string }).email
}

/** Область доступа лежит в закрытом поле библиотеки; читается приведением, как и в S2. */
function scopesOf(auth: unknown): string[] {
  const asked = (auth as { scopes?: string | string[] }).scopes
  expect(asked, 'библиотека больше не хранит область в поле scopes').toBeDefined()
  return [asked].flat() as string[]
}

afterEach(() => {
  // Поддельные ключи живут ровно одну проверку — временные каталоги за собой убираем.
  for (const каталог of каталоги.splice(0)) rmSync(каталог, { recursive: true, force: true })
})

describe('ключ служебного аккаунта', () => {
  it('ключ берётся из значения переменной', async () => {
    const клиент = await googleAuth(ОБЛАСТЬ, {
      GOOGLE_SERVICE_ACCOUNT_KEY: ключЗначением('из-значения@пример.iam'),
    }).getClient()

    expect(почтаКлиента(клиент)).toBe('из-значения@пример.iam')
  })

  it('ключ берётся из файла по пути', async () => {
    const путь = ключФайлом('из-файла@пример.iam')
    const клиент = await сНастоящимПутём(путь, () =>
      googleAuth(ОБЛАСТЬ, { GOOGLE_APPLICATION_CREDENTIALS: путь }).getClient(),
    )

    expect(почтаКлиента(клиент)).toBe('из-файла@пример.iam')
  })

  /**
   * Старшинство: значение задают в настройках хостинга под конкретный боевой запуск, а
   * путь к файлу — привычка машины разработчика, которая может остаться в окружении
   * случайно. Путь здесь заведомо негодный: возьмись он в дело, чтения файла не вышло бы.
   */
  it('при обеих заданных переменных берётся значение', async () => {
    const негодный = '/такого-файла-нет-и-не-будет.json'
    const клиент = await сНастоящимПутём(негодный, () =>
      googleAuth(ОБЛАСТЬ, {
        GOOGLE_SERVICE_ACCOUNT_KEY: ключЗначением('из-значения@пример.iam'),
        GOOGLE_APPLICATION_CREDENTIALS: негодный,
      }).getClient(),
    )

    expect(почтаКлиента(клиент)).toBe('из-значения@пример.iam')
  })

  /**
   * Отказ обязан называть, что человеку сделать руками, и обязан быть нашим, а не чужим:
   * голый `SyntaxError` от разбора JSON ничего не доказывает. Содержимого ключа в отказе
   * нет ни байтом — иначе секрет уедет в журнал вместе с сообщением.
   */
  it('отказ называет только имя недостающей переменной', () => {
    const кусокКлюча = 'BEGIN PRIVATE KEY'

    expect(() => googleAuth(ОБЛАСТЬ, { GOOGLE_SERVICE_ACCOUNT_KEY: 'не-json' })).toThrow(
      /GOOGLE_SERVICE_ACCOUNT_KEY/,
    )

    const безПочты = JSON.stringify({ private_key: `-----${кусокКлюча}-----` })
    let отказ: Error | undefined
    try {
      googleAuth(ОБЛАСТЬ, { GOOGLE_SERVICE_ACCOUNT_KEY: безПочты })
    } catch (e) {
      отказ = e as Error
    }

    expect(отказ, 'ключ без client_email обязан быть отказом, а не молчаливой работой').toBeDefined()
    expect(отказ!.message).toMatch(/GOOGLE_SERVICE_ACCOUNT_KEY/)
    expect(отказ!.message).toMatch(/client_email/)
    expect(отказ!.message).not.toContain(кусокКлюча)
  })

  it('область доступа не изменилась ни на одном из двух путей', () => {
    // Принятое утверждение S2 повторяется здесь на новом пути, а не правится там.
    const путь = ключФайлом('к@пример.iam')

    expect(
      scopesOf(googleAuth(ОБЛАСТЬ, { GOOGLE_SERVICE_ACCOUNT_KEY: ключЗначением('к@пример.iam') })),
    ).toEqual([ОБЛАСТЬ])
    expect(scopesOf(googleAuth(ОБЛАСТЬ, { GOOGLE_APPLICATION_CREDENTIALS: путь }))).toEqual([
      ОБЛАСТЬ,
    ])
  })
})
