import { GoogleAuth } from 'google-auth-library'

/**
 * Поход в Google — один на оба загрузчика.
 *
 * Здесь только чтение по адресу: ни способа задать метод, ни способа передать тело.
 * Запрос, меняющий что-нибудь у Google, этим договором просто не выражается.
 *
 * Способности не складываются в один объект нарочно. Загрузчик Таблицы собирает себе
 * доступ из одного `googleGet`, загрузчик Диска — из `googleGet` и `googleGetBytes`,
 * потому что список папки приезжает разобранным телом, а файл — байтами. Отдать обоим
 * один объект пошире значило бы выдать загрузчику Таблицы способность, которой он не
 * пользуется, — а лишнее право однажды окажется использованным.
 */

/** Ответ Google: код и уже разобранное тело. */
export type GoogleAnswer = {
  status: number
  body: unknown
}

/** Ответ Google байтами: код и содержимое файла, не тронутое раскодированием. */
export type GoogleBytesAnswer = {
  status: number
  bytes: Uint8Array
}

/** То, что отдаёт клиент Google: код и уже прочитанное тело в поле `data`. */
type GoogleRawAnswer = { status: number; data: unknown }

/**
 * Способ сходить в Google. Настоящий — авторизация из `google-auth-library`: она
 * подписывает запрос ключом служебного аккаунта и отдаёт не веб-ответ, а свой объект,
 * у которого тело уже прочитано и лежит в поле `data`.
 *
 * Форм вызова две, и обе — те, что объявляет сама библиотека: адресом строкой, либо
 * настройками одним объектом. Смешанной формы «адрес и настройки двумя доводами» у неё
 * нет: второй довод там — веб-настройки, а не её собственные. Живьём такой вызов
 * срабатывает, но опираться на неназванное поведение нельзя, и типы это показали.
 */
export type GoogleTransport = {
  fetch: {
    (url: string): Promise<GoogleRawAnswer>
    (options: { url: string; responseType: 'arraybuffer' }): Promise<GoogleRawAnswer>
  }
}

/**
 * Авторизация ровно на одну названную область доступа.
 *
 * Ключ служебного аккаунта библиотека читает сама по переменной
 * `GOOGLE_APPLICATION_CREDENTIALS`; наш код ключ не открывает, не разбирает и никуда
 * не печатает. Области не складываются: у каждого загрузчика своя авторизация.
 */
export function googleAuth(scope: string): GoogleAuth {
  return new GoogleAuth({ scopes: [scope] })
}

/** Читает по адресу разобранное тело. */
export function googleGet(transport: GoogleTransport): (url: string) => Promise<GoogleAnswer> {
  return async (url) => {
    const response = await transport.fetch(url)
    return { status: response.status, body: response.data }
  }
}

/**
 * Читает по адресу байты.
 *
 * Вид ответа называется явно, и это не перестраховка: проверено походом на Диск —
 * без него тело файла `text/csv` приезжает уже раскодированной строкой. По строке
 * нельзя ни сверить размер с тем, что назвал Диск, ни увидеть метку порядка байтов,
 * ни отличить один конец строки от другого без догадок о том, что сделал транспорт.
 */
export function googleGetBytes(
  transport: GoogleTransport,
): (url: string) => Promise<GoogleBytesAnswer> {
  return async (url) => {
    const response = await transport.fetch({ url, responseType: 'arraybuffer' })
    return { status: response.status, bytes: new Uint8Array(response.data as ArrayBuffer) }
  }
}
