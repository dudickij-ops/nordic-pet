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
 * `sha256Checksum`, `trashed` и `capabilities/canDownload` — все они там наблюдались, —
 * и содержимое файла байтами при коде 200.
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
    // Эти два поля настоящий Диск отдаёт по каждому файлу папки — проверено разведкой.
    // Без них счастливый путь проходился бы мимо них, и подставка обещала бы больше,
    // чем делает.
    trashed: false,
    capabilities: { canDownload: true },
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

  /**
   * Перечень взят из контракта, а не переписан с кода: проверка, написанная по коду,
   * молчит ровно тогда, когда код разошёлся с требованием.
   */
  it('просит все поля, названные контрактом', () => {
    const fields = new URL(adsFolderUrl(FOLDER)).searchParams.get('fields') ?? ''
    for (const field of [
      'id',
      'name',
      'mimeType',
      'size',
      'md5Checksum',
      'sha256Checksum',
      'trashed',
      'capabilities/canDownload',
      'nextPageToken',
      'incompleteSearch',
    ]) {
      expect(fields, `поле ${field} не запрошено`).toContain(field)
    }
  })

  // Идентификатор попадает в запрос между кавычек: кавычка в нём — другой запрос.
  it('идентификатор папки со знаками, которых там быть не может, — отказ', () => {
    expect(() => adsFolderUrl("' or name contains '")).toThrow(/GOOGLE_DRIVE_ADS_FOLDER_ID/)
  })

  // Снимок папки не должен зависеть от того, в каком порядке служба решила отдать файлы.
  it('просит порядок по имени', () => {
    expect(new URL(adsFolderUrl(FOLDER)).searchParams.get('orderBy')).toBe('name')
  })

  /**
   * Три параметра общих дисков — каждый своей проверкой.
   *
   * Проверяется состав адреса: то, что мы **отправляем**, а не то, что ответит Google.
   * Общего диска у нас нет, и наблюдать его поведение нечем — это названо вслух в
   * контракте куска и в теле pull request, а не спрятано.
   *
   * Проверки разведены по одной на параметр нарочно: одна общая осталась бы красной от
   * снятия любого из трёх, и снятие каждого доказывалось бы красным от соседнего.
   */
  it('список папки просит поддержку общих дисков', () => {
    const url = new URL(adsFolderUrl(FOLDER))
    expect(url.searchParams.get('supportsAllDrives')).toBe('true')
  })

  it('список папки включает в ответ файлы общих дисков', () => {
    const url = new URL(adsFolderUrl(FOLDER))
    expect(url.searchParams.get('includeItemsFromAllDrives')).toBe('true')
  })

  /**
   * Область поиска не задаётся: умолчание остаётся за Диском.
   *
   * Цитата, дословно: «By default, corpora is set to `user`. However, this can change
   * depending on the filter set through the `q` parameter» — а наш запрос такой фильтр
   * задаёт. Что значение `user` означает «только личный диск», справочник не говорит: это
   * был бы наш вывод, и здесь он не нужен вовсе.
   *
   * Наш вывод, помеченный как наш: задать `allDrives` значило бы завести поиск по
   * нескольким собраниям сразу — тот самый случай, для которого справочник называет
   * неполную выдачу и советует область сузить. Неполный список папки у нас отказ, и
   * загрузка упала бы целиком.
   */
  it('список папки не задаёт область поиска — умолчание остаётся за Диском', () => {
    const url = new URL(adsFolderUrl(FOLDER))
    expect(url.searchParams.get('corpora')).toBeNull()
  })

  it('следующую страницу просит по метке страницы', () => {
    expect(new URL(adsFolderUrl(FOLDER, 'метка')).searchParams.get('pageToken')).toBe('метка')
  })

  it('содержимое просится с alt=media, идентификатор перекодирован', () => {
    const url = new URL(fileMediaUrl('a/b?c'))
    expect(url.pathname).toBe('/drive/v3/files/a%2Fb%3Fc')
    expect(url.searchParams.get('alt')).toBe('media')
  })

  // Скачивание — второй адрес, и поддержка общих дисков нужна ему своя: без неё список
  // вернулся бы полным, а скачивание каждого файла отказало бы.
  it('содержимое файла просится с поддержкой общих дисков', () => {
    const url = new URL(fileMediaUrl('id-meta_2026-03.csv'))
    expect(url.searchParams.get('supportsAllDrives')).toBe('true')
  })

  /**
   * Проверяется область, которую доступ **просит**, а не постоянная рядом с ним.
   * Проверка постоянной осталась бы зелёной, если бы в доступ подставили другую область.
   */
  it('доступ к Диску просит область только на чтение Диска', () => {
    const asked: string[] = []
    driveAccess((scope) => {
      asked.push(scope)
      return { fetch: (async () => ({ status: 200, data: {} })) as never }
    })
    expect(asked).toEqual(['https://www.googleapis.com/auth/drive.readonly'])
    expect(DRIVE_READONLY_SCOPE).toBe('https://www.googleapis.com/auth/drive.readonly')
  })

  it('доступ к Диску умеет только читать: телом и байтами', () => {
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

  it('два файла с одинаковым именем — отказ, и в нём сказано, что делать', () => {
    const twice = [driveFile('meta_2026-03.csv', META), driveFile('meta_2026-03.csv', PINTEREST)]
    let text = ''
    try {
      chooseExportFiles(twice)
    } catch (error) {
      text = String(error)
    }
    expect(text).toContain('meta_2026-03.csv')
    expect(text).toMatch(/переимену|убер/i)
  })

  // Отказ узнаётся по своему признаку, а не по тому, что вызов вообще упал: голое
  // «упало» зеленеет на любой чужой ошибке, случившейся в том же месте.
  it('ноль выгрузок в папке — отказ, и он называет пропущенное', () => {
    let text = ''
    try {
      chooseExportFiles([driveFile('заметки.txt', 'x', { mimeType: 'text/plain' })])
    } catch (error) {
      text = String(error)
    }
    expect(text).toMatch(/ни одного файла \.csv/i)
    expect(text).toContain('заметки.txt')
  })

  /**
   * Половина беды, которую человек чинит руками: папка лежит на общем диске, а доступ
   * служебному аккаунту открыт к ней одной, а не к самому диску. Отказ при этом придёт
   * прежний — «ни одного файла .csv», — и он правдив, но уводит в сторону. Правдивая
   * причина, уводящая в сторону, хуже отсутствия причины.
   *
   * Отказ узнаётся по своему признаку, а не по одному лишь упоминанию общего диска:
   * красное на чужой ошибке ничего не доказывало бы.
   */
  it('отказ на ноль выгрузок называет доступ к общему диску', () => {
    let text = ''
    try {
      chooseExportFiles([driveFile('заметки.txt', 'x', { mimeType: 'text/plain' })])
    } catch (error) {
      text = String(error)
    }
    expect(text).toMatch(/ни одного файла \.csv/i)
    // Кириллица нарочно перечислена буквами: `\w` в JavaScript — только латиница, и
    // образец с ним не совпал бы ни с одним падежом.
    expect(text).toMatch(/общ[а-я]* диск/i)
  })

  it('файл из корзины в снимок не попадает молча', () => {
    const files = [driveFile('meta_2026-03.csv', META, { trashed: true })]
    let text = ''
    try {
      chooseExportFiles(files)
    } catch (error) {
      text = String(error)
    }
    expect(text).toContain('meta_2026-03.csv')
    expect(text).toMatch(/корзин/i)
  })

  it('файл, который служебному аккаунту скачивать нельзя, — отказ с указанием', () => {
    const files = [
      driveFile('meta_2026-03.csv', META, { capabilities: { canDownload: false } }),
    ]
    let text = ''
    try {
      chooseExportFiles(files)
    } catch (error) {
      text = String(error)
    }
    expect(text).toContain('meta_2026-03.csv')
    expect(text).toMatch(/доступ|просмотр/i)
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

  // Отказ на негодном идентификаторе обязан случаться там же, где отказ на пустой
  // переменной, — до единого обращения к Google. Текст сообщения этого не показывает,
  // а наблюдение за походами показывает.
  it('негодный идентификатор папки отвергается до единого обращения к Google', async () => {
    const drive = access([{ files: [] }])
    const text = await refusal(() =>
      readAdsFolder(drive, { GOOGLE_DRIVE_ADS_FOLDER_ID: "' or name contains '" }),
    )
    expect(text).toContain('GOOGLE_DRIVE_ADS_FOLDER_ID')
    expect(drive.calls).toHaveLength(0)
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

  it('одна и та же метка страницы по кругу — отказ, а не вечное ожидание', async () => {
    const page = { files: [driveFile('meta_2026-03.csv', META)], nextPageToken: 'та же' }
    const drive = access([page, page, page], { 'id-meta_2026-03.csv': META })
    expect(await refusal(() => readAdsFolder(drive, ENV))).toMatch(/по кругу/i)
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
