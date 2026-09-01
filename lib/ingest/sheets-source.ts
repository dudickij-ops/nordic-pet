import { GoogleAuth } from 'google-auth-library'

import { SHEETS } from '@/lib/ingest/sheet-rows'

/**
 * Чтение Таблицы «Nordic Pet — operations».
 *
 * Все шесть листов берутся одним запросом `values:batchGet`: снимок всех листов
 * оказывается взят близко к одному моменту, а не растянут по шести обращениям,
 * между которыми человек успевает править Таблицу.
 */

/** Значения листа, как их отдал Google: только строки, ряд за рядом. */
export type SheetValues = Record<string, string[][]>

/** Способ сходить в Google. Настоящий подписывает запрос ключом служебного аккаунта. */
export type SheetsAccess = {
  fetch: (url: string, init?: RequestInit) => Promise<Response>
}

/**
 * Область доступа — только чтение. Права на запись не запрашиваются вовсе:
 * возможность испортить источник закрывается отсутствием права, а не осторожностью в коде.
 */
export const SHEETS_READONLY_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly'

/** Переменная с идентификатором Таблицы. */
const SPREADSHEET_ID = 'GOOGLE_SHEETS_SPREADSHEET_ID'

type Environment = Record<string, string | undefined>

/**
 * Адрес запроса на чтение перечисленных листов.
 *
 * Диапазоном служит голое имя листа: по правилам A1 это все ячейки листа.
 * `majorDimension` и `valueRenderOption` — умолчания справочника, но названы явно:
 * умолчание можно поменять снаружи, написанное в запросе — нет. `FORMATTED_VALUE`
 * отдаёт значения так, как они показаны в листе, а преобразование при импорте в этой
 * Таблице выключено — значит показанное и есть точный текст файла.
 * `dateTimeRenderOption` не просится: справочник говорит, что при `FORMATTED_VALUE`
 * он не действует.
 */
export function operationsUrl(spreadsheetId: string, sheets: readonly string[]): string {
  const url = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchGet`,
  )
  for (const sheet of sheets) url.searchParams.append('ranges', sheet)
  url.searchParams.set('majorDimension', 'ROWS')
  url.searchParams.set('valueRenderOption', 'FORMATTED_VALUE')
  return url.toString()
}

/** Имя листа из поля `range` вида `orders!A1:G520` или `'Мой лист'!A1:B2`. */
function sheetOfRange(range: string): string {
  const name = range.split('!')[0] ?? ''
  return name.startsWith("'") && name.endsWith("'")
    ? name.slice(1, -1).replaceAll("''", "'")
    : name
}

/**
 * Раскладывает ответ по именам листов.
 *
 * Порядок разделов документирован — он тот же, что у запрошенных диапазонов, — но
 * проверяется всё равно: разобраться потом, почему возвраты легли в заказы, дороже.
 */
export function valuesFromBatchGet(body: unknown, sheets: readonly string[]): SheetValues {
  const ranges = (body as { valueRanges?: unknown } | null)?.valueRanges
  if (!Array.isArray(ranges)) {
    throw new Error('ответ Google не похож на ответ batchGet: в нём нет списка valueRanges')
  }
  if (ranges.length !== sheets.length) {
    throw new Error(
      `запрошено листов: ${sheets.length}, а разделов в ответе: ${ranges.length}. ` +
        'Снимок неполон, и грузить его нельзя',
    )
  }

  const values: SheetValues = {}
  for (const [index, sheet] of sheets.entries()) {
    const section = ranges[index] as { range?: string; values?: string[][] }
    const came = sheetOfRange(section?.range ?? '')
    if (came !== sheet) {
      throw new Error(
        `на месте листа ${sheet} пришёл раздел листа «${came}»: порядок ответа не совпал ` +
          'с порядком запроса, и молча переложить данные нельзя',
      )
    }
    // Лист, в котором нет ни одной заполненной ячейки, приезжает вообще без поля values.
    values[sheet] = section.values ?? []
  }
  return values
}

/**
 * Настоящий способ сходить в Google: ключ служебного аккаунта библиотека читает сама
 * по переменной `GOOGLE_APPLICATION_CREDENTIALS`. Наш код ключ не открывает, не разбирает
 * и никуда не печатает.
 */
export function sheetsAccess(): SheetsAccess {
  const auth = new GoogleAuth({ scopes: [SHEETS_READONLY_SCOPE] })
  return { fetch: (url, init) => auth.fetch(url, init) as Promise<Response> }
}

/** Читает шесть листов Таблицы. Без аргументов идёт настоящим путём. */
export async function readOperationsSpreadsheet(
  access?: SheetsAccess,
  env: Environment = process.env,
): Promise<SheetValues> {
  const spreadsheetId = env[SPREADSHEET_ID]
  if (spreadsheetId === undefined || spreadsheetId === '') {
    throw new Error(
      `${SPREADSHEET_ID} пуста: неизвестно, какую Таблицу читать. ` +
        'Переменная живёт в .env.local и в переменных Vercel, но никогда в git',
    )
  }

  const sheets = SHEETS.map((sheet) => sheet.sheet)
  const url = operationsUrl(spreadsheetId, sheets)
  const response = await (access ?? sheetsAccess()).fetch(url)

  if (!response.ok) {
    // Отказ Google обязан быть виден. Пустой снимок вместо него был бы хуже:
    // функции записи вычистили бы таблицы дочиста.
    const text = await response.text().catch(() => '')
    throw new Error(`Google отказал при чтении Таблицы: ${response.status}. ${text}`.trim())
  }

  return valuesFromBatchGet(await response.json(), sheets)
}
