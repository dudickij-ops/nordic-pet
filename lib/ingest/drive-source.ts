import { createHash } from 'node:crypto'

import {
  googleAuth,
  googleGet,
  googleGetBytes,
  type GoogleAnswer,
  type GoogleBytesAnswer,
  type GoogleTransport,
} from './google-access.ts'

/**
 * Чтение папки `ads-exports` на Google Диске.
 *
 * Два вида обращений, оба — чтение: список файлов папки и содержимое каждого файла.
 * Область доступа — только чтение Диска; права на запись не запрашиваются вовсе.
 *
 * Снимок берётся с папки целиком и уходит в базу одним куском. Отсюда строгость к
 * неполноте: файл, не попавший в список, будет из базы **удалён** — подчистка идёт по
 * всей папке. Поэтому неполный список, ноль выгрузок и нечитаемая выгрузка — отказы,
 * а не пропуски.
 */

/**
 * Область доступа — только чтение Диска.
 * Уже взять нечего: область на одни свойства файлов содержимое скачивать не даёт,
 * а область «на файлы приложения» рассчитана на файлы, которые приложение само создало
 * или человек выбрал через окно выбора, — служебный аккаунт с папкой, которой с ним
 * поделились, под это не подходит.
 */
export const DRIVE_READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly'

/** Переменная с идентификатором папки. Папка ищется по нему, а не по имени. */
const FOLDER_ID = 'GOOGLE_DRIVE_ADS_FOLDER_ID'

/** Тип, которым Google помечает свои собственные документы, а не файлы. */
const GOOGLE_DOCUMENT = 'application/vnd.google-apps.'

/** Поля списка, без которых снимок не проверить. Без явного перечня Диск отдаёт лишь часть. */
const FIELDS =
  'nextPageToken,incompleteSearch,' +
  'files(id,name,mimeType,size,md5Checksum,sha256Checksum,trashed,capabilities/canDownload)'

/** Файл папки, как его описывает Диск. */
export type DriveFile = {
  id: string
  name: string
  mimeType: string
  size?: string
  md5Checksum?: string
  sha256Checksum?: string
  trashed?: boolean
  capabilities?: { canDownload?: boolean }
}

/** Выгрузка, прочитанная целиком: имя из папки и байты как есть. */
export type AdsFile = {
  name: string
  bytes: Uint8Array
}

/** Прочитанная папка: выгрузки целиком и имена того, что выгрузками не является. */
export type FolderSnapshot = {
  files: AdsFile[]
  /** Пропущенное называется вслух: молчание однажды скроет выгрузку, названную не так. */
  skipped: string[]
}

/** Способ сходить на Диск: список приезжает разобранным телом, файл — байтами. */
export type DriveAccess = {
  get: (url: string) => Promise<GoogleAnswer>
  getBytes: (url: string) => Promise<GoogleBytesAnswer>
}

type Environment = Record<string, string | undefined>

/**
 * Адрес списка файлов папки.
 *
 * Идентификатор папки попадает в запрос между одинарных кавычек, поэтому его вид
 * проверяется: кавычка или косая черта в переменной окружения превратили бы запрос
 * в другой запрос. Идентификаторы Диска состоят из букв, цифр, дефиса и подчёркивания.
 */
export function adsFolderUrl(folderId: string, pageToken?: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(folderId)) {
    throw new Error(
      `${FOLDER_ID} не похожа на идентификатор папки Диска: в ней есть знаки, которых там ` +
        'быть не может. Идентификатор берут из адреса папки в браузере, после /folders/',
    )
  }
  const url = new URL('https://www.googleapis.com/drive/v3/files')
  url.searchParams.set('q', `'${folderId}' in parents and trashed = false`)
  url.searchParams.set('fields', FIELDS)
  url.searchParams.set('pageSize', '1000')
  // Порядок просим у службы: снимок папки не должен зависеть от того, в каком порядке
  // она решила отдать файлы.
  url.searchParams.set('orderBy', 'name')
  if (pageToken !== undefined) url.searchParams.set('pageToken', pageToken)
  return url.toString()
}

/** Адрес содержимого файла. */
export function fileMediaUrl(fileId: string): string {
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`)
  url.searchParams.set('alt', 'media')
  return url.toString()
}

/**
 * Настоящий доступ к Диску.
 *
 * Способ создать авторизацию подставляется, чтобы проверить можно было **запрошенную**
 * область, а не постоянную рядом с ней. Проверка постоянной осталась бы зелёной, если бы
 * сюда подставили другую область, — а это ровно та ошибка, от которой область и защищает.
 * Значение по умолчанию настоящее: вызов без аргументов идёт настоящим путём.
 */
export function driveAccess(
  makeAuth: (scope: string) => GoogleTransport = googleAuth,
): DriveAccess {
  const auth = makeAuth(DRIVE_READONLY_SCOPE)
  return { get: googleGet(auth), getBytes: googleGetBytes(auth) }
}

/**
 * Отбирает из содержимого папки выгрузки.
 *
 * Выгрузка — файл, чьё имя кончается на `.csv`. По имени, а не по типу: файлы кладёт
 * человек руками, имя — то, что он видит, а тип Диск присваивает сам при загрузке.
 * Всё остальное — подпапка, ярлык, заметка рядом — пропускается и называется вслух:
 * пропущенное, о котором никто не сказал, однажды окажется выгрузкой, названной не так.
 */
export function chooseExportFiles(files: readonly DriveFile[]): {
  exports: DriveFile[]
  skipped: string[]
} {
  const exports: DriveFile[] = []
  const skipped: string[] = []

  for (const file of files) {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      skipped.push(file.name)
      continue
    }
    // Google при загрузке умеет превращать CSV в Таблицу. У такого файла нет ни
    // содержимого для скачивания, ни контрольной суммы. Пропустить его нельзя:
    // подчистка идёт по всей папке, и стёрлись бы прошлые строки этой площадки —
    // вся её история, а не только новый месяц.
    if (file.mimeType.startsWith(GOOGLE_DOCUMENT)) {
      throw new Error(
        `файл ${file.name} на Диске не файл, а документ Google (${file.mimeType}): ` +
          'скачать его содержимое нельзя. Положите выгрузку на Диск файлом, без ' +
          'преобразования в Таблицу',
      )
    }
    // Запрос просит нетронутые корзиной файлы. Если такой всё же приехал, это не наша
    // ошибка и не повод грузить: снимок должен совпадать с тем, что человек видит в папке.
    if (file.trashed === true) {
      throw new Error(
        `файл ${file.name} лежит в корзине, хотя запрошены только живые файлы. Верните его ` +
          'из корзины или удалите насовсем — снимок папки обязан совпадать с тем, что видно',
      )
    }
    // Право на скачивание Диск называет сам, и справочник советует смотреть на него до
    // попытки скачать. Пропустить такой файл нельзя: подчистка идёт по всей папке.
    if (file.capabilities?.canDownload === false) {
      throw new Error(
        `файл ${file.name} служебному аккаунту скачивать нельзя: Диск говорит, что права на ` +
          'это нет. Откройте служебному аккаунту доступ «Просмотр» на папку целиком',
      )
    }
    exports.push(file)
  }

  // Диск допускает два файла с одинаковым именем в одной папке, а адрес строки в базе —
  // имя файла плюс номер строки. Два одноимённых файла слились бы в один адрес, и
  // половина расхода исчезла бы, не оставив следа.
  const seen = new Set<string>()
  for (const file of exports) {
    if (seen.has(file.name)) {
      throw new Error(
        `в папке два файла с именем ${file.name}. Адрес строки в базе — имя файла плюс ` +
          'номер строки, и различить их нечем. Переименуйте один из них или уберите лишний',
      )
    }
    seen.add(file.name)
  }

  if (exports.length === 0) {
    throw new Error(
      'в папке ads-exports нет ни одного файла .csv. Ноль выгрузок почти всегда означает ' +
        'сбой чтения папки, а не опустевшую папку, и грузить такой снимок нельзя: он стёр ' +
        'бы из базы всё, что там есть' +
        (skipped.length > 0 ? `. Пропущено как не выгрузки: ${skipped.join(', ')}` : ''),
    )
  }

  return { exports, skipped }
}

/** Сверяет скачанное с тем, что Диск назвал в списке. */
function checkIntegrity(file: DriveFile, bytes: Uint8Array): void {
  if (file.size !== undefined && Number(file.size) !== bytes.length) {
    throw new Error(
      `файл ${file.name} скачался не целиком: Диск назвал ${file.size} байт, а приехало ` +
        `${bytes.length}. Загрузка отменена: неполный файл — это потерянные строки`,
    )
  }

  const expected = file.sha256Checksum ?? file.md5Checksum
  if (expected === undefined) {
    throw new Error(
      `у файла ${file.name} Диск не назвал ни одной контрольной суммы, а у файла с ` +
        'содержимым она есть всегда. Сверить скачанное не с чем, и грузить его нельзя',
    )
  }

  const actual = createHash(file.sha256Checksum !== undefined ? 'sha256' : 'md5')
    .update(bytes)
    .digest('hex')

  if (actual !== expected) {
    throw new Error(
      `файл ${file.name} приехал не таким, каким его назвал Диск: контрольные суммы не ` +
        'сошлись. Либо файл правили прямо во время чтения, либо он испортился по дороге — ' +
        'запустите загрузку заново',
    )
  }
}

/**
 * Читает папку целиком: сперва весь список, потом содержимое каждой выгрузки.
 *
 * Без аргументов идёт настоящим путём. Снимок неатомарен и быть атомарным не может:
 * список — одно обращение, скачивание — ещё по одному на файл. Сверка размера и
 * контрольной суммы ловит файл, изменившийся в этом промежутке; файл, добавленный после
 * получения списка, приедет следующим прогоном.
 */
export async function readAdsFolder(
  access?: DriveAccess,
  env: Environment = process.env,
): Promise<FolderSnapshot> {
  const folderId = env[FOLDER_ID]
  if (folderId === undefined || folderId === '') {
    throw new Error(
      `${FOLDER_ID} пуста: неизвестно, какую папку читать. Переменная живёт в .env.local ` +
        'и в переменных Vercel, но никогда в git',
    )
  }

  const drive = access ?? driveAccess()
  const found: DriveFile[] = []
  const seenTokens = new Set<string>()
  let pageToken: string | undefined

  do {
    const answer = await drive.get(adsFolderUrl(folderId, pageToken))
    if (answer.status !== 200) {
      throw new Error(`Диск ответил кодом ${answer.status}: список папки не получен`)
    }

    const page = answer.body as {
      files?: DriveFile[]
      nextPageToken?: string
      incompleteSearch?: boolean
    }

    // Неполный список — это тихое удаление: строки файла, который в него не попал,
    // из базы исчезнут, потому что подчистка идёт по всей папке.
    if (page.incompleteSearch === true) {
      throw new Error(
        'Диск отдал неполный список папки. Грузить такой снимок нельзя: строки файлов, ' +
          'не попавших в список, были бы удалены из базы. Запустите загрузку заново',
      )
    }

    found.push(...(page.files ?? []))

    // Служба, вернувшая ту же метку страницы, увела бы нас в вечный круг — загрузка
    // висела бы молча, а это хуже отказа.
    if (page.nextPageToken !== undefined && seenTokens.has(page.nextPageToken)) {
      throw new Error(
        'Диск отдаёт одну и ту же метку страницы списка по кругу: список папки не ' +
          'дочитывается. Запустите загрузку заново',
      )
    }
    if (page.nextPageToken !== undefined) seenTokens.add(page.nextPageToken)
    pageToken = page.nextPageToken
  } while (pageToken !== undefined)

  const { exports, skipped } = chooseExportFiles(found)

  const read: AdsFile[] = []
  for (const file of exports) {
    const answer = await drive.getBytes(fileMediaUrl(file.id))
    if (answer.status !== 200) {
      throw new Error(`файл ${file.name} не скачался: Диск ответил кодом ${answer.status}`)
    }
    checkIntegrity(file, answer.bytes)
    read.push({ name: file.name, bytes: answer.bytes })
  }

  return { files: read, skipped }
}
