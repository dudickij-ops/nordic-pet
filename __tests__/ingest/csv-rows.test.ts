import { describe, expect, it } from 'vitest'

import { rowsFromCsv } from '@/lib/ingest/csv-rows'

/**
 * Разбор одного файла выгрузки: байты → строки снимка.
 *
 * Ни сети, ни базы. Значения полей не трогаются ничем: суммы, даты и пробелы доезжают
 * в базу посимвольно. Разбор и чистка — работа S4.
 *
 * Числа и формы взяты с настоящих файлов папки, какими их отдал Диск на разведке:
 * заголовок `date,campaign,spend_usd`, три файла с концом строки CRLF, один — с LF.
 */

const NAME = 'meta_2026-03.csv'
const HEADER = 'date,campaign,spend_usd'

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text)

function refusal(call: () => unknown): string {
  try {
    call()
  } catch (error) {
    return String(error)
  }
  throw new Error('вызов не отказал, хотя должен был')
}

describe('конец строки', () => {
  const lines = [HEADER, '2026-03-01,Prospecting DE,30.51', '2026-03-02,Broad EU,40.40']

  /**
   * Два файла `meta` в папке совпадают посимвольно и различаются только концом строки:
   * 2908 байт против 2814. Снимки обязаны совпасть полностью, включая адреса, — иначе
   * S4 не сможет сравнить выгрузки построчно.
   */
  it('CRLF и LF дают один и тот же снимок', () => {
    const crlf = rowsFromCsv(NAME, bytes(lines.join('\r\n') + '\r\n'))
    const lf = rowsFromCsv(NAME, bytes(lines.join('\n') + '\n'))
    expect(crlf).toEqual(lf)
  })

  it('одиночный возврат каретки — тоже конец строки', () => {
    expect(rowsFromCsv(NAME, bytes(lines.join('\r'))).rows).toHaveLength(2)
  })

  it('перевод строки в конце файла не порождает пустой строки', () => {
    const snapshot = rowsFromCsv(NAME, bytes(lines.join('\n') + '\n'))
    expect(snapshot.rows).toHaveLength(2)
    expect(snapshot.rowsRead).toBe(2)
    expect(snapshot.rowsSkipped).toBe(0)
  })

  it('файл без перевода строки в конце разбирается так же', () => {
    expect(rowsFromCsv(NAME, bytes(lines.join('\n')))).toEqual(
      rowsFromCsv(NAME, bytes(lines.join('\n') + '\n')),
    )
  })
})

describe('метка порядка байтов', () => {
  /**
   * Метка — признак транспорта, а не данные. Не срезав её, мы бы искали столбец `date`
   * и не нашли: в заголовке он назывался бы иначе на три невидимых байта.
   */
  it('срезается, и первый столбец находится', () => {
    const snapshot = rowsFromCsv(NAME, bytes('﻿' + HEADER + '\n2026-03-01,Brand,19.26\n'))
    expect(snapshot.rows[0].date).toBe('2026-03-01')
  })

  it('снимок с меткой и без неё одинаков', () => {
    const text = HEADER + '\n2026-03-01,Brand,19.26\n'
    expect(rowsFromCsv(NAME, bytes('﻿' + text))).toEqual(rowsFromCsv(NAME, bytes(text)))
  })

  /**
   * Две проверки выше метку переживают и без срезания: имена заголовков обрезаются от
   * пробелов, а метка по правилам языка пробельный символ и снимается обрезкой заодно.
   * Выяснилось это сломом — обе остались зелёными, когда срезание убрали.
   *
   * Случай, который решает именно срезание: заголовок в кавычках. Метка встаёт перед
   * первой кавычкой, поле перестаёт считаться закавыченным, и столбец приезжает с
   * кавычками в имени — то есть пропадает.
   */
  it('метка перед закавыченным заголовком не ломает сопоставление столбцов', () => {
    const snapshot = rowsFromCsv(
      NAME,
      bytes('﻿"date","campaign","spend_usd"\n2026-03-01,Brand,19.26\n'),
    )
    expect(snapshot.rows[0]).toEqual({
      file_name: NAME,
      row_no: 2,
      date: '2026-03-01',
      campaign: 'Brand',
      spend_usd: '19.26',
    })
  })
})

describe('кавычки', () => {
  /**
   * Сегодня в папке нет ни одной кавычки. Правило написано ради выгрузки, где кампанию
   * назовут «Spring, sale»: деление по запятой не отказало бы, а молча сдвинуло поля и
   * положило кусок названия в сумму расхода.
   */
  it('запятая внутри кавычек не делит поле', () => {
    const snapshot = rowsFromCsv(NAME, bytes(`${HEADER}\n2026-03-01,"Spring, sale",19.26\n`))
    expect(snapshot.rows[0]).toEqual({
      file_name: NAME,
      row_no: 2,
      date: '2026-03-01',
      campaign: 'Spring, sale',
      spend_usd: '19.26',
    })
  })

  it('удвоенная кавычка внутри поля становится одной', () => {
    const snapshot = rowsFromCsv(NAME, bytes(`${HEADER}\n2026-03-01,"он сказал ""да""",19.26\n`))
    expect(snapshot.rows[0].campaign).toBe('он сказал "да"')
  })

  it('перевод строки внутри кавычек не разрывает запись, а адрес следующей его учитывает', () => {
    const snapshot = rowsFromCsv(
      NAME,
      bytes(`${HEADER}\n2026-03-01,"Spring\nsale",19.26\n2026-03-02,Broad,40.40\n`),
    )
    expect(snapshot.rows).toEqual([
      { file_name: NAME, row_no: 2, date: '2026-03-01', campaign: 'Spring\nsale', spend_usd: '19.26' },
      { file_name: NAME, row_no: 4, date: '2026-03-02', campaign: 'Broad', spend_usd: '40.40' },
    ])
  })

  it('кавычки в середине незакавыченного поля остаются значением', () => {
    const snapshot = rowsFromCsv(NAME, bytes(`${HEADER}\n2026-03-01,15" экран,19.26\n`))
    expect(snapshot.rows[0].campaign).toBe('15" экран')
  })
})

describe('адреса и строки', () => {
  it('первая строка данных получает адрес 2', () => {
    const snapshot = rowsFromCsv(NAME, bytes(`${HEADER}\n2026-03-01,Brand,19.26\n`))
    expect(snapshot.rows[0].row_no).toBe(2)
  })

  it('пустая строка в середине пропущена, адреса соседей не сдвинулись', () => {
    const snapshot = rowsFromCsv(
      NAME,
      bytes(`${HEADER}\n2026-03-01,A,1\n\n2026-03-03,B,3\n`),
    )
    expect(snapshot.rows.map((row) => row.row_no)).toEqual([2, 4])
    expect(snapshot.rowsSkipped).toBe(1)
  })

  it('короткая строка добивается пустыми полями', () => {
    const snapshot = rowsFromCsv(NAME, bytes(`${HEADER}\n2026-03-01,Brand\n`))
    expect(snapshot.rows[0].spend_usd).toBe('')
  })

  it('имя файла едет в каждой строке посимвольно', () => {
    const tricky = 'meta_2026-03 (1).csv'
    const snapshot = rowsFromCsv(tricky, bytes(`${HEADER}\n2026-03-01,Brand,19.26\n`))
    expect(snapshot.rows[0].file_name).toBe('meta_2026-03 (1).csv')
  })

  it('грязь доезжает посимвольно', () => {
    const snapshot = rowsFromCsv(NAME, bytes(`${HEADER}\n01.03.2026, Brand ,1 234,50\n`))
    expect(snapshot.rows[0].date).toBe('01.03.2026')
    expect(snapshot.rows[0].campaign).toBe(' Brand ')
  })
})

describe('столбцы', () => {
  it('пропавший столбец — отказ с именем файла и недостающим именем', () => {
    const text = refusal(() => rowsFromCsv(NAME, bytes('date,campaign\n2026-03-01,Brand\n')))
    expect(text).toContain(NAME)
    expect(text).toContain('spend_usd')
  })

  it('повторённый заголовок — отказ', () => {
    const text = refusal(() =>
      rowsFromCsv(NAME, bytes('date,campaign,campaign,spend_usd\n1,2,3,4\n')),
    )
    expect(text).toContain('campaign')
  })

  it('лишний столбец загрузку не останавливает и называется вслух', () => {
    const snapshot = rowsFromCsv(NAME, bytes(`${HEADER},заметка\n2026-03-01,Brand,19.26,ок\n`))
    expect(snapshot.extraColumns).toEqual(['заметка'])
    expect(snapshot.rows[0]).not.toHaveProperty('заметка')
  })
})

describe('пустой файл', () => {
  /**
   * Возражение «а вдруг площадку останавливали» не работает: остановленная площадка
   * выражается отсутствием файла в папке. Файл, который есть и пуст, — след сбоя выгрузки.
   * Поэтому отказ, и он говорит человеку, что сделать.
   */
  it('файл с одним заголовком — отказ, и в нём сказано, что делать', () => {
    const text = refusal(() => rowsFromCsv(NAME, bytes(`${HEADER}\n`)))
    expect(text).toContain(NAME)
    expect(text).toMatch(/не клад/i)
    expect(text).toMatch(/повтор/i)
  })

  it('файл из одних пустых строк — тот же отказ', () => {
    expect(refusal(() => rowsFromCsv(NAME, bytes(`${HEADER}\n\n\n`)))).toContain(NAME)
  })

  it('пустой файл — отказ с именем файла', () => {
    expect(refusal(() => rowsFromCsv(NAME, bytes('')))).toContain(NAME)
  })
})
