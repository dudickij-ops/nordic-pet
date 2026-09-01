import { describe, expect, it } from 'vitest'

import { googleAuth, googleGet, googleGetBytes } from '@/lib/ingest/google-access'
import { sheetsAuth, SHEETS_READONLY_SCOPE } from '@/lib/ingest/sheets-source'

/**
 * Обвязка Google одна на оба загрузчика. Проверяется здесь ровно то, что она делает
 * сама: просит одну названную область доступа и ходит по адресу — телом или байтами.
 *
 * Сети здесь нет. Способ сходить подставляется, и подставка изображает ровно ту форму,
 * которую отдал настоящий клиент на разведке 1 сентября 2026 года: объект с полями
 * `status` и `data`. Ничего сверх наблюдённого подставка не изображает.
 */

const DRIVE_READONLY = 'https://www.googleapis.com/auth/drive.readonly'

type Call = { url: string; responseType?: string }

/**
 * Подставленный способ сходить: записывает вызовы и отдаёт заготовленный ответ.
 *
 * Принимает обе формы вызова, объявленные библиотекой, — адрес строкой и настройки
 * объектом, — потому что настоящий клиент принимает ровно их.
 */
function transport(data: unknown, status = 200) {
  const calls: Call[] = []
  return {
    calls,
    fetch: async (request: string | { url: string; responseType: string }) => {
      const call = typeof request === 'string' ? { url: request } : request
      calls.push({ url: call.url, responseType: (call as Call).responseType })
      return { status, data }
    },
  }
}

/** Область доступа лежит в закрытом поле библиотеки; читается приведением, как и в S2. */
function scopesOf(auth: unknown): string[] {
  const asked = (auth as { scopes?: string | string[] }).scopes
  expect(asked, 'библиотека больше не хранит область в поле scopes').toBeDefined()
  return [asked].flat() as string[]
}

describe('область доступа', () => {
  it('просится ровно одна и ровно та, которую назвали', () => {
    expect(scopesOf(googleAuth(DRIVE_READONLY))).toEqual([DRIVE_READONLY])
  })

  it('область Таблиц осталась прежней и единственной', () => {
    expect(scopesOf(sheetsAuth())).toEqual([SHEETS_READONLY_SCOPE])
  })

  /**
   * Области не складываются. Общая авторизация на две области выдала бы загрузчику
   * Таблицы право читать весь Диск задаром — а он туда не ходит и ходить не должен.
   */
  it('загрузчик Таблицы права на Диск не получает', () => {
    expect(scopesOf(sheetsAuth())).not.toContain(DRIVE_READONLY)
  })
})

describe('чтение разобранного тела', () => {
  it('ходит по адресу и отдаёт код вместе с разобранным телом', async () => {
    const google = transport({ files: [{ name: 'meta_2026-03.csv' }] })
    const answer = await googleGet(google)('https://www.googleapis.com/drive/v3/files')

    expect(google.calls.map((call) => call.url)).toEqual([
      'https://www.googleapis.com/drive/v3/files',
    ])
    expect(answer).toEqual({ status: 200, body: { files: [{ name: 'meta_2026-03.csv' }] } })
  })

  it('вида ответа не просит: тело и так приезжает разобранным', async () => {
    const google = transport({})
    await googleGet(google)('https://www.googleapis.com/drive/v3/files')
    expect(google.calls[0].responseType).toBeUndefined()
  })

  it('не двухсотый код доезжает наверх, а не превращается в пустоту', async () => {
    const google = transport({ error: { message: 'File not found' } }, 404)
    expect((await googleGet(google)('https://x/y')).status).toBe(404)
  })
})

describe('чтение байтов', () => {
  /**
   * Байты просятся явно. Проверено на живом Диске: без этого тело файла `text/csv`
   * приезжает строкой, уже раскодированной чужими правилами, и ни размер сверить,
   * ни метку порядка байтов увидеть по ней нельзя.
   */
  it('просит у транспорта именно байты', async () => {
    const google = transport(new Uint8Array([1, 2, 3]).buffer)
    await googleGetBytes(google)('https://www.googleapis.com/drive/v3/files/x?alt=media')
    expect(google.calls[0].responseType).toBe('arraybuffer')
  })

  it('отдаёт байты как есть, не теряя ни одного', async () => {
    // Настоящий клиент отдаёт тело `ArrayBuffer` — проверено походом на Диск.
    const google = transport(new Uint8Array([0xef, 0xbb, 0xbf, 0x64]).buffer)
    const answer = await googleGetBytes(google)('https://x/y?alt=media')

    expect(answer.status).toBe(200)
    expect(answer.bytes).toBeInstanceOf(Uint8Array)
    expect([...answer.bytes]).toEqual([0xef, 0xbb, 0xbf, 0x64])
  })

  it('не двухсотый код доезжает наверх и здесь', async () => {
    const google = transport(new ArrayBuffer(0), 403)
    expect((await googleGetBytes(google)('https://x/y?alt=media')).status).toBe(403)
  })
})
