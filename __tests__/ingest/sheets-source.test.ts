import { describe, expect, it } from 'vitest'

import {
  operationsUrl,
  readOperationsSpreadsheet,
  sheetsAccess,
  sheetsAuth,
  SHEETS_READONLY_SCOPE,
  valuesFromBatchGet,
  type SheetsAccess,
} from '@/lib/ingest/sheets-source'
import { SHEETS } from '@/lib/ingest/sheet-rows'

const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz'
const NAMES = SHEETS.map((s) => s.sheet)

/** Ответ Google на batchGet: по разделу на каждый запрошенный лист, в том же порядке. */
function batchGet(sections: Array<{ sheet: string; values?: string[][] }>) {
  return {
    spreadsheetId: ID,
    valueRanges: sections.map(({ sheet, values }) => ({
      range: `${sheet}!A1:Z1000`,
      majorDimension: 'ROWS',
      ...(values === undefined ? {} : { values }),
    })),
  }
}

/**
 * Подставленный доступ: записывает адрес и отдаёт заготовленный ответ.
 *
 * Отдаёт он то же, что и настоящий клиент Google, — код и уже разобранное тело.
 * Прежняя подстановка отдавала веб-ответ, которого настоящий клиент не отдаёт никогда,
 * и проверки зеленели на пути, которого в бою не существует.
 */
function access(body: unknown, status = 200): SheetsAccess & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    get: async (url) => {
      calls.push(url)
      return { status, body }
    },
  }
}

function refusal(call: () => unknown): string {
  try {
    call()
  } catch (error) {
    return String(error)
  }
  throw new Error('вызов не отказал, хотя должен был')
}

async function asyncRefusal(call: () => Promise<unknown>): Promise<string> {
  try {
    await call()
  } catch (error) {
    return String(error)
  }
  throw new Error('вызов не отказал, хотя должен был')
}

describe('запрос на чтение шести листов', () => {
  it('идёт в Google Таблицы методом batchGet', () => {
    const url = new URL(operationsUrl(ID, NAMES))
    expect(url.host).toBe('sheets.googleapis.com')
    expect(url.pathname).toBe(`/v4/spreadsheets/${ID}/values:batchGet`)
  })

  it('называет все шесть листов в порядке контракта', () => {
    const url = new URL(operationsUrl(ID, NAMES))
    expect(url.searchParams.getAll('ranges')).toEqual([
      'orders',
      'refunds',
      'costs',
      'fees',
      'opex',
      'fx',
    ])
  })

  // Оба значения — умолчания по справочнику, но умолчание можно поменять снаружи,
  // а написанное в запросе — нет.
  it('называет вид ответа явно, не полагаясь на умолчания', () => {
    const url = new URL(operationsUrl(ID, NAMES))
    expect(url.searchParams.get('majorDimension')).toBe('ROWS')
    expect(url.searchParams.get('valueRenderOption')).toBe('FORMATTED_VALUE')
  })

  // Справочник: при FORMATTED_VALUE dateTimeRenderOption не действует. Просить его —
  // значит делать вид, что он на что-то влияет.
  it('не просит dateTimeRenderOption: при FORMATTED_VALUE он не действует', () => {
    expect(operationsUrl(ID, NAMES)).not.toContain('dateTimeRenderOption')
  })

  it('перекодирует опасные знаки в идентификаторе Таблицы', () => {
    const url = new URL(operationsUrl('a/b?c=d', NAMES))
    expect(url.pathname).toBe('/v4/spreadsheets/a%2Fb%3Fc%3Dd/values:batchGet')
  })

  /**
   * Проверяется тот самый объект, которым ходят в Google, а не постоянная рядом с ним:
   * постоянную никто не обязан использовать, и подмена области в объекте оставила бы
   * проверку постоянной зелёной.
   *
   * Поле области в типах библиотеки закрыто, поэтому читается через приведение — это
   * названо вслух и осознанно. Если библиотека однажды переименует поле, проверка
   * покраснеет и потребует посмотреть, а не позеленеет молча.
   */
  it('область доступа у настоящего клиента — только чтение', () => {
    const asked = (sheetsAuth() as unknown as { scopes?: string | string[] }).scopes
    expect(asked, 'библиотека больше не хранит область в поле scopes').toBeDefined()
    expect([asked].flat()).toEqual(['https://www.googleapis.com/auth/spreadsheets.readonly'])
    expect(SHEETS_READONLY_SCOPE).toBe('https://www.googleapis.com/auth/spreadsheets.readonly')
  })
})

describe('разбор ответа', () => {
  it('раскладывает разделы по именам листов', () => {
    const body = batchGet([
      { sheet: 'orders', values: [['date'], ['01.03.2026']] },
      { sheet: 'refunds', values: [['refund_date']] },
      { sheet: 'costs', values: [['sku']] },
      { sheet: 'fees', values: [['gateway']] },
      { sheet: 'opex', values: [['month']] },
      { sheet: 'fx', values: [['date']] },
    ])
    const values = valuesFromBatchGet(body, NAMES)
    expect(Object.keys(values)).toEqual(NAMES)
    expect(values.orders).toEqual([['date'], ['01.03.2026']])
  })

  // Лист без единой заполненной ячейки приезжает вообще без поля values.
  it('лист без данных приезжает без поля values — это пустой список, а не падение', () => {
    const body = batchGet(NAMES.map((sheet) => ({ sheet })))
    expect(valuesFromBatchGet(body, NAMES).orders).toEqual([])
  })

  it('разделов пришло меньше, чем листов запрошено, — отказ', () => {
    const body = batchGet(NAMES.slice(0, 5).map((sheet) => ({ sheet })))
    expect(refusal(() => valuesFromBatchGet(body, NAMES))).toMatch(/6|шест/i)
  })

  // Порядок разделов документирован, но проверить его дешевле, чем разбирать потом,
  // почему возвраты легли в заказы.
  it('раздел не от того листа — отказ, а не молчаливая перекладка', () => {
    const shuffled = batchGet([
      { sheet: 'refunds', values: [['refund_date']] },
      { sheet: 'orders', values: [['date']] },
      { sheet: 'costs' },
      { sheet: 'fees' },
      { sheet: 'opex' },
      { sheet: 'fx' },
    ])
    const text = refusal(() => valuesFromBatchGet(shuffled, NAMES))
    expect(text).toContain('orders')
  })

  it('ответ не того вида — отказ', () => {
    expect(() => valuesFromBatchGet(null, NAMES)).toThrow()
    expect(() => valuesFromBatchGet({}, NAMES)).toThrow()
    expect(() => valuesFromBatchGet({ valueRanges: 'нет' }, NAMES)).toThrow()
  })
})

describe('чтение Таблицы', () => {
  const env = { GOOGLE_SHEETS_SPREADSHEET_ID: ID }

  it('ходит по собранному адресу и отдаёт разобранные значения', async () => {
    const google = access(batchGet(NAMES.map((sheet) => ({ sheet, values: [[sheet]] }))))
    const values = await readOperationsSpreadsheet(google, env)
    expect(google.calls).toEqual([operationsUrl(ID, NAMES)])
    expect(values.fx).toEqual([['fx']])
  })

  // Дашборд только читает. Запись невозможна не по договорённости, а по устройству:
  // настоящий доступ умеет ровно одно — прочитать по адресу.
  it('настоящий доступ умеет только читать', () => {
    expect(Object.keys(sheetsAccess())).toEqual(['get'])
  })

  it('без переменной с Таблицей отказывается и не ходит в сеть', async () => {
    const google = access({})
    const text = await asyncRefusal(() => readOperationsSpreadsheet(google, {}))
    expect(text).toContain('GOOGLE_SHEETS_SPREADSHEET_ID')
    expect(google.calls).toHaveLength(0)
  })

  // Настоящий клиент до этой ветки не доходит: на не-двухсотый ответ он поднимает
  // ошибку сам, и она идёт наверх как есть — проверено опытом на живой Таблице.
  // Это второй замок, на случай другого клиента.
  it('ответ не двухсотый — отказ, а не пустой снимок', async () => {
    const google = access({ error: { message: 'Requested entity was not found.' } }, 404)
    expect(await asyncRefusal(() => readOperationsSpreadsheet(google, env))).toContain('404')
  })
})
