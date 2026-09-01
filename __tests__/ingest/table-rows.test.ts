import { describe, expect, it } from 'vitest'

import { snapshotFromTable, type TableRow, type TableSpec } from '@/lib/ingest/table-rows'

/**
 * Общий разбор «заголовок и строки»: сопоставление столбцов по имени, отказ на пропавшем
 * и на повторившемся, называние лишнего, добивка короткой строки, пропуск пустой.
 *
 * Правила у листа Таблицы и у файла с Диска совпадают дословно, поэтому и разбор один.
 * Отличается только слово, которым источник называют человеку, и адрес строки: лист
 * считает его от начала листа, файл — от начала файла. Оба приезжают сюда готовыми.
 */

const ADS: TableSpec = { kind: 'file', name: 'meta_2026-03.csv', columns: ['date', 'campaign', 'spend_usd'] }
const SHEET: TableSpec = { kind: 'sheet', name: 'orders', columns: ['date', 'order_id'] }

const HEADER = ['date', 'campaign', 'spend_usd']

/** Строки файла: адрес — номер строки в источнике, заголовок первый. */
function rows(...values: string[][]): TableRow[] {
  return values.map((cells, index) => ({ values: cells, rowNo: index + 2 }))
}

function refusal(call: () => unknown): string {
  try {
    call()
  } catch (error) {
    return String(error)
  }
  throw new Error('вызов не отказал, хотя должен был')
}

describe('сопоставление столбцов', () => {
  it('берёт значения по имени столбца, а не по месту', () => {
    const snapshot = snapshotFromTable(
      ADS,
      ['campaign', 'spend_usd', 'date'],
      rows(['Brand', '19.26', '2026-03-01']),
    )
    expect(snapshot.rows).toEqual([
      { row_no: 2, date: '2026-03-01', campaign: 'Brand', spend_usd: '19.26' },
    ])
  })

  it('пропавший столбец — отказ, и в нём названы источник и недостающее', () => {
    const text = refusal(() => snapshotFromTable(ADS, ['date', 'campaign'], rows(['2026-03-01', 'Brand'])))
    expect(text).toContain('meta_2026-03.csv')
    expect(text).toContain('spend_usd')
  })

  it('повторённый заголовок — отказ: выбирать одно из двух значений нельзя', () => {
    const text = refusal(() =>
      snapshotFromTable(ADS, ['date', 'campaign', 'campaign', 'spend_usd'], rows(['a', 'b', 'c', 'd'])),
    )
    expect(text).toContain('campaign')
  })

  it('имена заголовков сравниваются без пробелов по краям', () => {
    const snapshot = snapshotFromTable(ADS, [' date ', 'campaign', 'spend_usd'], rows(['2026-03-01', 'Brand', '1']))
    expect(snapshot.rows[0].date).toBe('2026-03-01')
  })

  it('лишний столбец загрузку не останавливает, но называется вслух', () => {
    const snapshot = snapshotFromTable(
      ADS,
      [...HEADER, 'заметка'],
      rows(['2026-03-01', 'Brand', '19.26', 'проверить']),
    )
    expect(snapshot.extraColumns).toEqual(['заметка'])
    expect(snapshot.rows[0]).toEqual({
      row_no: 2,
      date: '2026-03-01',
      campaign: 'Brand',
      spend_usd: '19.26',
    })
  })

  it('столбец без заголовка называется местом, если в нём есть данные', () => {
    const snapshot = snapshotFromTable(ADS, [...HEADER, ''], rows(['2026-03-01', 'Brand', '19.26', 'что-то']))
    expect(snapshot.extraColumns[0]).toMatch(/заголовк/i)
    expect(snapshot.extraColumns[0]).toContain('4')
  })

  it('пустой столбец без заголовка не называется: называть нечего', () => {
    const snapshot = snapshotFromTable(ADS, [...HEADER, ''], rows(['2026-03-01', 'Brand', '19.26', '']))
    expect(snapshot.extraColumns).toEqual([])
  })
})

describe('строки', () => {
  it('короткая строка добивается пустыми значениями, а не пропусками', () => {
    const snapshot = snapshotFromTable(ADS, HEADER, rows(['2026-03-01', 'Brand']))
    expect(snapshot.rows[0]).toEqual({
      row_no: 2,
      date: '2026-03-01',
      campaign: 'Brand',
      spend_usd: '',
    })
  })

  /**
   * Адрес строки берётся из источника, а не из порядка: пропуск пустой строки не имеет
   * права сдвинуть адреса тех, кто под ней.
   */
  it('пустая строка пропущена, а адреса соседей не сдвинулись', () => {
    const snapshot = snapshotFromTable(ADS, HEADER, rows(['2026-03-01', 'A', '1'], [], ['2026-03-03', 'B', '3']))
    expect(snapshot.rows.map((row) => row.row_no)).toEqual([2, 4])
    expect(snapshot.rowsRead).toBe(3)
    expect(snapshot.rowsSkipped).toBe(1)
  })

  it('строка из одних пустых значений считается пустой', () => {
    const snapshot = snapshotFromTable(ADS, HEADER, rows(['2026-03-01', 'A', '1'], ['', '', '']))
    expect(snapshot.rows).toHaveLength(1)
    expect(snapshot.rowsSkipped).toBe(1)
  })

  it('значения не трогаются ничем: грязь доезжает посимвольно', () => {
    const snapshot = snapshotFromTable(ADS, HEADER, rows(['01.03.2026', ' np-003 ', '1 234,50']))
    expect(snapshot.rows[0]).toEqual({
      row_no: 2,
      date: '01.03.2026',
      campaign: ' np-003 ',
      spend_usd: '1 234,50',
    })
  })
})

describe('как источник называют человеку', () => {
  it('файл называется файлом', () => {
    expect(refusal(() => snapshotFromTable(ADS, ['date'], rows(['x'])))).toContain('в файле')
  })

  it('лист называется листом', () => {
    expect(refusal(() => snapshotFromTable(SHEET, ['date'], rows(['x'])))).toContain('в листе')
  })
})
