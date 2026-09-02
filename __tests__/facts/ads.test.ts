import { describe, expect, test } from 'vitest'

import { foldCopies, platformOf, type AdsFile } from '@/lib/facts/ads'

/**
 * Площадка из имени файла и свёртка копий выгрузки — две задачи, оставленные S3.
 * Обе — толкование, и обе живут в слое фактов.
 */

/** Файл выгрузки с разобранными строками. */
function file(fileName: string, rows: Array<[number, string, string, string]>): AdsFile {
  return {
    fileName,
    platform: platformOf(fileName),
    rows: rows.map(([rowNo, date, campaign, spend]) => ({ rowNo, date, campaign, spend })),
  }
}

const META_ROWS: Array<[number, string, string, string]> = [
  [2, '2026-03-01', 'Broad EU', '12.40'],
  [3, '2026-03-02', 'Broad EU', '9.80'],
]

describe('площадка из имени файла', () => {
  test('три площадки источника выводятся из своих имён', () => {
    expect(platformOf('meta_2026-03.csv')).toBe('meta')
    expect(platformOf('google_2026-03.csv')).toBe('google')
    expect(platformOf('pinterest_2026-03.csv')).toBe('pinterest')
  })

  test('скобка и пробел в имени площадке не мешают', () => {
    expect(platformOf('meta_2026-03 (1).csv')).toBe('meta')
  })

  test('регистр имени снимается: MeTa и meta — одна площадка', () => {
    expect(platformOf('META_2026-03.csv')).toBe('meta')
    expect(platformOf('MeTa_2026-03.csv')).toBe('meta')
  })

  test.each(['report.csv', '_2026-03.csv', '   _x.csv', '.csv'])(
    'имя, из которого площадку не вывести, — отказ: %s',
    (name) => {
      expect(() => platformOf(name)).toThrow(/площадк/i)
    },
  )

  test('отказ называет файл и говорит, как называть файлы', () => {
    let message = ''
    try {
      platformOf('report.csv')
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain('report.csv')
    expect(message).toMatch(/подчёркивани/i)
  })
})

describe('свёртка копий выгрузки', () => {
  test('два файла с одинаковыми строками — копии: остаётся один', () => {
    const { kept, folded } = foldCopies([
      file('meta_2026-03.csv', META_ROWS),
      file('meta_2026-03 (1).csv', META_ROWS),
    ])

    expect(kept.map((f) => f.fileName)).toEqual(['meta_2026-03.csv'])
    expect(folded).toEqual([
      { fileName: 'meta_2026-03 (1).csv', copyOf: 'meta_2026-03.csv', rows: 2 },
    ])
  })

  test('копия опознаётся по содержимому, а не по похожести имён', () => {
    // Имя со скобкой — совпадение. Копией файл делает совпавшее содержимое, и ничто другое:
    // два файла одной площадки с совсем непохожими именами всё равно копии.
    const { kept, folded } = foldCopies([
      file('meta_2026-03.csv', META_ROWS),
      file('meta_выгрузка от Оли, финальная.csv', META_ROWS),
    ])
    expect(kept).toHaveLength(1)
    expect(folded).toHaveLength(1)
  })

  test('одинаковые имена площадки с разным содержимым копиями не считаются', () => {
    const { kept, folded } = foldCopies([
      file('meta_2026-03.csv', META_ROWS),
      file('meta_2026-03 (1).csv', [
        [2, '2026-03-01', 'Broad EU', '12.40'],
        [3, '2026-03-02', 'Broad EU', '11.11'],
      ]),
    ])
    expect(kept).toHaveLength(2)
    expect(folded).toEqual([])
  })

  test('адрес строки в отпечаток не входит', () => {
    // Экземпляр с лишней пустой строкой посреди файла несёт те же значения и другие
    // номера строк. По номерам копия перестала бы опознаваться, и деньги удвоились бы.
    const { kept, folded } = foldCopies([
      file('meta_2026-03.csv', META_ROWS),
      file('meta_2026-03 (1).csv', [
        [2, '2026-03-01', 'Broad EU', '12.40'],
        [7, '2026-03-02', 'Broad EU', '9.80'],
      ]),
    ])
    expect(kept).toHaveLength(1)
    expect(folded).toHaveLength(1)
  })

  test('порядок строк внутри файла на опознание не влияет', () => {
    const { kept } = foldCopies([
      file('meta_2026-03.csv', META_ROWS),
      file('meta_2026-03 (1).csv', [...META_ROWS].reverse()),
    ])
    expect(kept).toHaveLength(1)
  })

  test('совпавшее содержимое у РАЗНЫХ площадок копией не делает', () => {
    // Здесь свёртка стёрла бы расход целой площадки, а не лишний экземпляр одной.
    // Площадка — часть содержимого строки факта, и отпечаток её учитывает.
    const { kept, folded } = foldCopies([
      file('google_2026-03.csv', META_ROWS),
      file('pinterest_2026-03.csv', META_ROWS),
    ])
    expect(kept.map((f) => f.fileName).sort()).toEqual([
      'google_2026-03.csv',
      'pinterest_2026-03.csv',
    ])
    expect(folded).toEqual([])
  })

  test('три экземпляра одного содержимого сворачиваются в один', () => {
    const { kept, folded } = foldCopies([
      file('meta_a.csv', META_ROWS),
      file('meta_bb.csv', META_ROWS),
      file('meta_ccc.csv', META_ROWS),
    ])
    expect(kept).toHaveLength(1)
    expect(folded).toHaveLength(2)
    expect(folded.every((f) => f.copyOf === 'meta_a.csv')).toBe(true)
  })

  test('выбор пережившего не зависит от порядка файлов на входе', () => {
    // Иначе адреса 93 строк фактов прыгали бы от прогона к прогону, а с ними — след,
    // по которому число на экране возводится к строке источника.
    const prepared = [
      file('meta_2026-03 (1).csv', META_ROWS),
      file('meta_2026-03.csv', META_ROWS),
    ]
    expect(foldCopies(prepared).kept[0].fileName).toBe('meta_2026-03.csv')
    expect(foldCopies([...prepared].reverse()).kept[0].fileName).toBe('meta_2026-03.csv')
  })

  test('при равной длине имён переживает первое по порядку кодовых знаков', () => {
    const { kept } = foldCopies([file('meta_bb.csv', META_ROWS), file('meta_aa.csv', META_ROWS)])
    expect(kept[0].fileName).toBe('meta_aa.csv')
  })

  test('сравнение не языковое: порядок не зависит от настроек машины', () => {
    // Имена подобраны так, что два порядка расходятся: по кодовым знакам «B» (66) идёт
    // раньше «a» (97), а по языковым правилам — наоборот. Языковое сравнение зависит от
    // настроек машины, и на другой машине адреса строк фактов оказались бы другими.
    expect('meta_B.csv'.localeCompare('meta_a.csv')).toBeGreaterThan(0)

    const { kept } = foldCopies([file('meta_a.csv', META_ROWS), file('meta_B.csv', META_ROWS)])
    expect(kept[0].fileName).toBe('meta_B.csv')
  })

  test('единственный файл не сворачивается и остаётся как есть', () => {
    const { kept, folded } = foldCopies([file('meta_2026-03.csv', META_ROWS)])
    expect(kept).toHaveLength(1)
    expect(folded).toEqual([])
  })

  test('строки пережившего файла доезжают до фактов без изменений', () => {
    const { kept } = foldCopies([
      file('meta_2026-03.csv', META_ROWS),
      file('meta_2026-03 (1).csv', META_ROWS),
    ])
    expect(kept[0].rows).toEqual([
      { rowNo: 2, date: '2026-03-01', campaign: 'Broad EU', spend: '12.40' },
      { rowNo: 3, date: '2026-03-02', campaign: 'Broad EU', spend: '9.80' },
    ])
  })
})
