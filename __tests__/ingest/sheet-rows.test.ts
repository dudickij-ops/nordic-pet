import { describe, expect, it } from 'vitest'

import { SHEETS, snapshotFromValues, type SheetSpec } from '@/lib/ingest/sheet-rows'

/** Лист orders — на нём проверяется всё, что не зависит от состава столбцов. */
const orders = () => sheetSpec('orders')

function sheetSpec(name: string): SheetSpec {
  const spec = SHEETS.find((s) => s.sheet === name)
  if (!spec) throw new Error(`в SHEETS нет листа ${name}`)
  return spec
}

const HEADER = ['date', 'order_id', 'sku', 'units', 'gross_eur', 'discount_eur', 'gateway']

/** Строка данных, какой её отдаёт Google: только строки, без чисел. */
const row = (id: string) => ['01.03.2026', id, 'NP-001', '1', '24,90', '', 'stripe']

/** Текст ошибки, поднятой вызовом. Если вызов не упал — проверка обязана упасть здесь. */
function refusal(call: () => unknown): string {
  try {
    call()
  } catch (error) {
    return String(error)
  }
  throw new Error('вызов не отказал, хотя должен был')
}

describe('адрес строки — номер строки в самом листе', () => {
  it('первая строка данных получает адрес 2, а не 1', () => {
    const snapshot = snapshotFromValues(orders(), [HEADER, row('A-1'), row('A-2')])
    expect(snapshot.rows.map((r) => r.row_no)).toEqual([2, 3])
  })

  it('адрес — число, а не строка: в базе колонка целочисленная', () => {
    const snapshot = snapshotFromValues(orders(), [HEADER, row('A-1')])
    expect(typeof snapshot.rows[0].row_no).toBe('number')
  })
})

describe('пустота, которой Google не присылает', () => {
  // «For output, empty trailing rows and columns will not be included» — справочник ValueRange.
  it('короткая строка добита пустыми ячейками, а не пропущена', () => {
    const short = ['01.03.2026', 'A-1', 'NP-001']
    const snapshot = snapshotFromValues(orders(), [HEADER, short])
    expect(snapshot.rows[0]).toEqual({
      row_no: 2,
      date: '01.03.2026',
      order_id: 'A-1',
      sku: 'NP-001',
      units: '',
      gross_eur: '',
      discount_eur: '',
      gateway: '',
    })
  })

  it('добивает пустой строкой, а не «нет данных»', () => {
    const snapshot = snapshotFromValues(orders(), [HEADER, ['01.03.2026', 'A-1']])
    expect(snapshot.rows[0].units).toBe('')
    expect(snapshot.rows[0].units).not.toBeNull()
    expect(snapshot.rows[0].units).not.toBeUndefined()
  })

  it('пустая строка в середине пропущена, а адреса соседей не сдвинулись', () => {
    const snapshot = snapshotFromValues(orders(), [HEADER, row('A-1'), [], row('A-3')])
    expect(snapshot.rows.map((r) => r.row_no)).toEqual([2, 4])
    expect(snapshot.rows.map((r) => r.order_id)).toEqual(['A-1', 'A-3'])
    expect(snapshot.rowsSkipped).toBe(1)
  })

  it('строка из одних пустых ячеек — тоже пустая строка', () => {
    const snapshot = snapshotFromValues(orders(), [HEADER, row('A-1'), ['', '', '', ''], row('A-3')])
    expect(snapshot.rows.map((r) => r.row_no)).toEqual([2, 4])
  })

  it('ячейка из одних пробелов — это данные, а не пустота', () => {
    const snapshot = snapshotFromValues(orders(), [HEADER, row('A-1'), ['', ' ', '', ''], row('A-3')])
    expect(snapshot.rows.map((r) => r.row_no)).toEqual([2, 3, 4])
    expect(snapshot.rows[1].order_id).toBe(' ')
  })
})

describe('кривизна источника доезжает нетронутой', () => {
  it.each([
    ['дата по-европейски', 0, '01.03.2026'],
    ['дата по-машинному', 0, '2026-03-01'],
    ['артикул с хвостовым пробелом', 2, 'np-003 '],
    ['артикул с неразрывным дефисом', 2, 'NP‑003'],
    ['сумма с неразрывным пробелом и запятой', 4, '1 234,50'],
  ])('%s доезжает посимвольно', (_name, at, value) => {
    const dirty = row('A-1')
    dirty[at] = value
    const snapshot = snapshotFromValues(orders(), [HEADER, dirty])
    expect(snapshot.rows[0][HEADER[at]]).toBe(value)
  })

  it('не обрезает пробелы в значениях, даже обрезав их в заголовке', () => {
    const header = [...HEADER]
    header[2] = ' sku '
    const snapshot = snapshotFromValues(orders(), [header, row('A-1')])
    expect(snapshot.rows[0].sku).toBe('NP-001')

    const spaced = row('A-1')
    spaced[2] = ' NP-001 '
    expect(snapshotFromValues(orders(), [header, spaced]).rows[0].sku).toBe(' NP-001 ')
  })
})

describe('столбцы сопоставляются по имени', () => {
  it('переставленные столбцы разложены по именам, а не по местам', () => {
    const header = ['gateway', 'sku', 'units', 'date', 'order_id', 'discount_eur', 'gross_eur']
    const values = ['stripe', 'NP-007', '3', '02.03.2026', 'A-9', '1,00', '30,00']
    const snapshot = snapshotFromValues(orders(), [header, values])
    expect(snapshot.rows[0]).toEqual({
      row_no: 2,
      date: '02.03.2026',
      order_id: 'A-9',
      sku: 'NP-007',
      units: '3',
      gross_eur: '30,00',
      discount_eur: '1,00',
      gateway: 'stripe',
    })
  })

  it('пропавший столбец — отказ с названием листа и недостающего имени', () => {
    const header = HEADER.filter((c) => c !== 'gross_eur')
    const text = refusal(() => snapshotFromValues(orders(), [header, row('A-1').slice(0, 6)]))
    expect(text).toContain('orders')
    expect(text).toContain('gross_eur')
  })

  it('два одинаковых заголовка — отказ: сопоставление стало двусмысленным', () => {
    const header = [...HEADER]
    header[5] = 'sku'
    const text = refusal(() => snapshotFromValues(orders(), [header, row('A-1')]))
    expect(text).toContain('sku')
  })

  // Человек дописал колонку с заметками. Это не повод останавливать дашборд,
  // но и промолчать нельзя: однажды это окажется колонка, которая была нужна.
  it('лишний столбец не мешает загрузке и назван вслух', () => {
    const header = [...HEADER, 'заметка']
    const values = [...row('A-1'), 'перезвонить']
    const snapshot = snapshotFromValues(orders(), [header, values])
    expect(snapshot.extraColumns).toEqual(['заметка'])
    expect(snapshot.rows[0].order_id).toBe('A-1')
    expect(snapshot.rows[0]).not.toHaveProperty('заметка')
  })

  it('столбец без заголовка тоже назван вслух', () => {
    const header = [...HEADER, '']
    const snapshot = snapshotFromValues(orders(), [header, [...row('A-1'), 'что-то']])
    expect(snapshot.extraColumns).toHaveLength(1)
    expect(snapshot.extraColumns[0]).toMatch(/заголовк/i)
  })

  it('строка, где заполнен только лишний столбец, не теряется', () => {
    const header = [...HEADER, 'заметка']
    const onlyNote = ['', '', '', '', '', '', '', 'перезвонить']
    const snapshot = snapshotFromValues(orders(), [header, [...row('A-1'), ''], onlyNote])
    expect(snapshot.rows.map((r) => r.row_no)).toEqual([2, 3])
  })
})

describe('лист, из которого нечего грузить', () => {
  it('лист без единой строки данных — отказ с названием листа', () => {
    expect(refusal(() => snapshotFromValues(orders(), [HEADER]))).toContain('orders')
  })

  it('лист, где остались одни пустые строки, — тоже отказ', () => {
    expect(refusal(() => snapshotFromValues(orders(), [HEADER, [], ['', '']]))).toContain('orders')
  })

  it('лист без строки заголовков — отказ', () => {
    expect(refusal(() => snapshotFromValues(orders(), []))).toContain('orders')
  })
})

describe('состав листов повторяет контракт S1', () => {
  it('шесть листов, ни больше ни меньше', () => {
    expect(SHEETS.map((s) => s.sheet)).toEqual([
      'orders',
      'refunds',
      'costs',
      'fees',
      'opex',
      'fx',
    ])
  })

  it.each([
    ['orders', 'date,order_id,sku,units,gross_eur,discount_eur,gateway'],
    ['refunds', 'refund_date,order_id,sku,units,amount_eur'],
    ['costs', 'sku,cost_eur,valid_from'],
    ['fees', 'gateway,percent,fixed_eur'],
    ['opex', 'month,category,amount_eur'],
    ['fx', 'date,usd_per_eur'],
  ])('у листа %s столбцы из контракта', (name, columns) => {
    expect(sheetSpec(name).columns.join(',')).toBe(columns)
  })

  it('каждый лист пишется своей функцией записи снимка', () => {
    for (const spec of SHEETS) {
      expect(spec.fn).toBe(`raw.replace_${spec.sheet}`)
      expect(spec.table).toBe(`raw.${spec.sheet}`)
    }
  })

  it('каждый лист разбирается своими столбцами, а не чужими', () => {
    const fx = sheetSpec('fx')
    const snapshot = snapshotFromValues(fx, [['date', 'usd_per_eur'], ['01.03.2026', '1,0850']])
    expect(snapshot.rows[0]).toEqual({ row_no: 2, date: '01.03.2026', usd_per_eur: '1,0850' })
  })
})

describe('лист, который длиннее предела числа доводов', () => {
  // Ширина листа считалась раскрытием массива во все строки. Свыше примерно
  // шестидесяти тысяч строк это отказ движка, а не данных: молча и не там, где ищут.
  it('лист в двести тысяч строк разбирается, а не роняет движок', () => {
    const values: string[][] = [HEADER]
    for (let i = 0; i < 200_000; i += 1) values.push([])
    values.push(row('A-последний'))

    const snapshot = snapshotFromValues(orders(), values)
    expect(snapshot.rows).toHaveLength(1)
    expect(snapshot.rows[0].row_no).toBe(200_002)
    expect(snapshot.rowsSkipped).toBe(200_000)
  })
})
