import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  adsFolderUrl,
  chooseExportFiles,
  driveAccess,
  DRIVE_READONLY_SCOPE,
  fileMediaUrl,
  readAdsFolder,
  type DriveAccess,
  type DriveFile,
} from '@/lib/ingest/drive-source'

/**
 * Чтение папки `ads-exports`: список файлов и содержимое каждого.
 *
 * Подставка изображает ровно ту форму, которую отдал настоящий Диск на разведке
 * 1 сентября 2026 года: список с полями `id`, `name`, `mimeType`, `size`, `md5Checksum`,
 * `sha256Checksum` и содержимое файла байтами при коде 200.
 *
 * Чего разведка не видела — превращённого в Таблицу файла, неполного списка, двух
 * одноимённых файлов, — то проверяется на **нашей** стороне: на списке, который мы сами
 * и составили. Подставного ответа Google, которого никто не видел, здесь нет.
 */

const FOLDER = '1AbCdEfGhIjKlMnOpQrS'
const ENV = { GOOGLE_DRIVE_ADS_FOLDER_ID: FOLDER }

const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text)
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const md5 = (bytes: Uint8Array): string => createHash('md5').update(bytes).digest('hex')

/** Файл в списке — такой, каким его описывает Диск. */
function driveFile(name: string, content: string, over: Partial<DriveFile> = {}): DriveFile {
  const bytes = bytesOf(content)
  return {
    id: `id-${name}`,
    name,
    mimeType: 'text/csv',
    size: String(bytes.length),
    md5Checksum: md5(bytes),
    sha256Checksum: sha256(bytes),
    ...over,
  }
}

const META = 'date,campaign,spend_usd\r\n2026-03-01,Prospecting DE,30.51\r\n'
const PINTEREST = 'date,campaign,spend_usd\r\n2026-03-01,Winter coats,14.61\r\n'

/**
 * Подставленный доступ к Диску: отдаёт заготовленные страницы списка и содержимое
 * по идентификатору файла, записывая все адреса, по которым к нему сходили.
 */
function access(
  pages: Array<{ files: DriveFile[]; nextPageToken?: string; incompleteSearch?: boolean }>,
  contents: Record<string, string> = {},
  mediaStatus = 200,
): DriveAccess & { calls: string[] } {
  const calls: string[] = []
  let page = 0
  return {
    calls,
    get: async (url) => {
      calls.push(url)
      const body = pages[page]
      page += 1
      return { status: 200, body: { ...body, incompleteSearch: body.incompleteSearch ?? false } }
    },
    getBytes: async (url) => {
      calls.push(url)
      const id = decodeURIComponent(url.split('/files/')[1].split('?')[0])
      return { status: mediaStatus, bytes: bytesOf(contents[id] ?? '') }
    },
  }
}

async function refusal(call: () => Promise<unknown>): Promise<string> {
  try {
    await call()
  } catch (error) {
    return String(error)
  }
  throw new Error('вызов не отказал, хотя должен был')
}

describe('адреса запросов', () => {
  it('список идёт в Диск и спрашивает содержимое папки', () => {
    const url = new URL(adsFolderUrl(FOLDER))
    expect(url.host).toBe('www.googleapis.com')
    expect(url.pathname).toBe('/drive/v3/files')
    expect(url.searchParams.get('q')).toBe(`'${FOLDER}' in parents and trashed = false`)
  })

  it('просит именно те поля, без которых снимок не проверить', () => {
    const fields = new URL(adsFolderUrl(FOLDER)).searchParams.get('fields') ?? ''
    for (const field of ['name', 'mimeType', 'size', 'md5Checksum', 'sha256Checksum']) {
      expect(fields, `поле ${field} не запрошено`).toContain(field)
    }
    expect(fields).toContain('nextPageToken')
    expect(fields).toContain('incompleteSearch')
  })

  // Снимок папки не должен зависеть от того, в каком порядке служба решила отдать файлы.
  it('просит порядок по имени', () => {
    expect(new URL(adsFolderUrl(FOLDER)).searchParams.get('orderBy')).toBe('name')
  })

  it('следующую страницу просит по метке страницы', () => {
    expect(new URL(adsFolderUrl(FOLDER, 'метка')).searchParams.get('pageToken')).toBe('метка')
  })

  it('содержимое просится с alt=media, идентификатор перекодирован', () => {
    const url = new URL(fileMediaUrl('a/b?c'))
    expect(url.pathname).toBe('/drive/v3/files/a%2Fb%3Fc')
    expect(url.searchParams.get('alt')).toBe('media')
  })

  it('область доступа — только чтение Диска', () => {
    expect(DRIVE_READONLY_SCOPE).toBe('https://www.googleapis.com/auth/drive.readonly')
    expect(Object.keys(driveAccess()).sort()).toEqual(['get', 'getBytes'])
  })
})

describe('отбор файлов папки', () => {
  it('берёт только .csv, остальное пропускает и называет вслух', () => {
    const chosen = chooseExportFiles([
      driveFile('meta_2026-03.csv', META),
      driveFile('заметки.txt', 'что-то', { mimeType: 'text/plain' }),
      driveFile('старое', '', { mimeType: 'application/vnd.google-apps.folder' }),
    ])
    expect(chosen.exports.map((file) => file.name)).toEqual(['meta_2026-03.csv'])
    expect(chosen.skipped).toEqual(['заметки.txt', 'старое'])
  })

  it('расширение читается без учёта регистра', () => {
    const chosen = chooseExportFiles([driveFile('META_2026-03.CSV', META)])
    expect(chosen.exports).toHaveLength(1)
  })

  /**
   * Google при загрузке умеет превращать CSV в Таблицу. Пропустить такой файл нельзя:
   * подчистка идёт по всей папке, и его прошлые строки были бы стёрты — исчезла бы вся
   * история площадки, а не только новый месяц.
   */
  it('файл .csv, оказавшийся Таблицей Google, — отказ, и в нём сказано, что делать', () => {
    const files = [
      driveFile('meta_2026-03.csv', '', {
        mimeType: 'application/vnd.google-apps.spreadsheet',
        size: undefined,
        md5Checksum: undefined,
        sha256Checksum: undefined,
      }),
    ]
    let text = ''
    try {
      chooseExportFiles(files)
    } catch (error) {
      text = String(error)
    }
    expect(text).toContain('meta_2026-03.csv')
    expect(text).toMatch(/файлом|без преобразования/i)
  })

  it('два файла с одинаковым именем — отказ: адрес строки стал бы двусмысленным', () => {
    const twice = [driveFile('meta_2026-03.csv', META), driveFile('meta_2026-03.csv', PINTEREST)]
    let text = ''
    try {
      chooseExportFiles(twice)
    } catch (error) {
      text = String(error)
    }
    expect(text).toContain('meta_2026-03.csv')
  })

  it('ноль выгрузок в папке — отказ', () => {
    expect(() => chooseExportFiles([driveFile('заметки.txt', 'x')])).toThrow()
  })
})

describe('чтение папки целиком', () => {
  it('читает список и содержимое каждой выгрузки', async () => {
    const files = [driveFile('meta_2026-03.csv', META), driveFile('pinterest_2026-03.csv', PINTEREST)]
    const drive = access([{ files }], {
      'id-meta_2026-03.csv': META,
      'id-pinterest_2026-03.csv': PINTEREST,
    })

    const read = await readAdsFolder(drive, ENV)

    expect(read.files.map((file) => file.name)).toEqual([
      'meta_2026-03.csv',
      'pinterest_2026-03.csv',
    ])
    expect(new TextDecoder().decode(read.files[0].bytes)).toBe(META)
    expect(drive.calls[0]).toBe(adsFolderUrl(FOLDER))
  })

  it('без переменной с папкой отказывается и в сеть не ходит', async () => {
    const drive = access([{ files: [] }])
    const text = await refusal(() => readAdsFolder(drive, {}))
    expect(text).toContain('GOOGLE_DRIVE_ADS_FOLDER_ID')
    expect(drive.calls).toHaveLength(0)
  })

  it('идёт по всем страницам списка', async () => {
    const drive = access(
      [
        { files: [driveFile('meta_2026-03.csv', META)], nextPageToken: 'вторая' },
        { files: [driveFile('pinterest_2026-03.csv', PINTEREST)] },
      ],
      { 'id-meta_2026-03.csv': META, 'id-pinterest_2026-03.csv': PINTEREST },
    )

    const read = await readAdsFolder(drive, ENV)

    expect(read.files.map((file) => file.name)).toEqual([
      'meta_2026-03.csv',
      'pinterest_2026-03.csv',
    ])
    expect(drive.calls[1]).toBe(adsFolderUrl(FOLDER, 'вторая'))
  })

  /**
   * Неполный список — это тихое удаление: подчистка идёт по всей папке, и строки файла,
   * который в список не попал, были бы стёрты.
   */
  /**
   * Проверка различающая нарочно. Сперва она была написана так, что содержимое файла
   * подставке не давали вовсе, — и она зеленела на отказе про несовпавший размер, в
   * тексте которого тоже есть слово «неполный». Выяснилось сломом: защиту от неполного
   * списка убрали, а проверка осталась зелёной.
   *
   * Теперь содержимое отдаётся исправно, а отказ узнаётся по тому, что до скачивания
   * дело не дошло вовсе: неполный список останавливает загрузку сразу.
   */
  it('неполный список — отказ, и он случается до скачивания', async () => {
    const drive = access([{ files: [driveFile('meta_2026-03.csv', META)], incompleteSearch: true }], {
      'id-meta_2026-03.csv': META,
    })

    const text = await refusal(() => readAdsFolder(drive, ENV))

    expect(text).toMatch(/неполный список/i)
    expect(drive.calls.some((call) => call.includes('alt=media'))).toBe(false)
  })

  it('не двухсотый код при скачивании — отказ с именем файла', async () => {
    const drive = access([{ files: [driveFile('meta_2026-03.csv', META)] }], {}, 403)
    expect(await refusal(() => readAdsFolder(drive, ENV))).toContain('meta_2026-03.csv')
  })
})

describe('целостность скачанного', () => {
  it('размер разошёлся с тем, что назвал Диск, — отказ с именем файла', async () => {
    const file = driveFile('meta_2026-03.csv', META, { size: '99999' })
    const drive = access([{ files: [file] }], { 'id-meta_2026-03.csv': META })
    expect(await refusal(() => readAdsFolder(drive, ENV))).toContain('meta_2026-03.csv')
  })

  /**
   * Сверка стоит ноль лишних обращений и ловит два разных случая: порчу при передаче и
   * правку файла человеком между списком и скачиванием.
   */
  it('контрольная сумма разошлась — отказ с именем файла', async () => {
    const file = driveFile('meta_2026-03.csv', META, {
      sha256Checksum: sha256(bytesOf('совсем другое содержимое')),
      md5Checksum: md5(bytesOf('совсем другое содержимое')),
    })
    const drive = access([{ files: [file] }], { 'id-meta_2026-03.csv': META })
    expect(await refusal(() => readAdsFolder(drive, ENV))).toContain('meta_2026-03.csv')
  })

  it('сверяет и по одной только md5, если другой Диск не назвал', async () => {
    const good = driveFile('meta_2026-03.csv', META, { sha256Checksum: undefined })
    const drive = access([{ files: [good] }], { 'id-meta_2026-03.csv': META })
    await expect(readAdsFolder(drive, ENV)).resolves.toHaveProperty('files.length', 1)

    const bad = driveFile('meta_2026-03.csv', META, {
      sha256Checksum: undefined,
      md5Checksum: md5(bytesOf('другое')),
    })
    const broken = access([{ files: [bad] }], { 'id-meta_2026-03.csv': META })
    expect(await refusal(() => readAdsFolder(broken, ENV))).toContain('meta_2026-03.csv')
  })

  it('ни одной контрольной суммы у файла — отказ', async () => {
    const file = driveFile('meta_2026-03.csv', META, {
      md5Checksum: undefined,
      sha256Checksum: undefined,
    })
    const drive = access([{ files: [file] }], { 'id-meta_2026-03.csv': META })
    expect(await refusal(() => readAdsFolder(drive, ENV))).toContain('meta_2026-03.csv')
  })
})
