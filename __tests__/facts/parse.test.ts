import { describe, expect, test } from 'vitest'

import {
  CellError,
  parseAmount,
  parseDate,
  parseMonth,
  parseSku,
  parseUnits,
  requireText,
} from '@/lib/facts/parse'

/**
 * Разбор значений источника. Ни базы, ни сети: на вход текст ячейки и её адрес,
 * на выход — значение или отказ, называющий место и то, что человеку делать.
 */

const at = { source: 'в листе orders', rowNo: 7, column: 'date' }

/** Ошибка, поднятая вызовом, — целиком, чтобы смотреть и текст, и адрес. */
function refusal(run: () => unknown): CellError {
  try {
    run()
  } catch (error) {
    return error as CellError
  }
  throw new Error('отказа не случилось, а он ожидался')
}

describe('дата', () => {
  test('обе формы источника разбираются в одну и ту же дату', () => {
    expect(parseDate('2026-03-01', at)).toBe('2026-03-01')
    expect(parseDate('01.03.2026', at)).toBe('2026-03-01')
  })

  test('форма с точками читается как день-месяц-год, а не наоборот', () => {
    // В источнике форма с точками одна, и она европейская. Прочитанное наоборот
    // третье апреля переехало бы в март и утащило бы за собой выручку дня.
    expect(parseDate('03.04.2026', at)).toBe('2026-04-03')
  })

  test('крайние дни месяца и високосный год разбираются', () => {
    expect(parseDate('31.03.2026', at)).toBe('2026-03-31')
    expect(parseDate('29.02.2024', at)).toBe('2024-02-29')
  })

  test('несуществующая дата — отказ, а не переезд на следующий месяц', () => {
    expect(refusal(() => parseDate('31.02.2026', at)).message).toMatch(/31\.02\.2026/)
    expect(refusal(() => parseDate('2026-02-31', at)).message).toMatch(/2026-02-31/)
    expect(refusal(() => parseDate('29.02.2026', at)).message).toMatch(/29\.02\.2026/)
    expect(refusal(() => parseDate('2026-13-01', at)).message).toMatch(/2026-13-01/)
    expect(refusal(() => parseDate('00.03.2026', at)).message).toMatch(/00\.03\.2026/)
  })

  test.each(['01/03/2026', '1 марта', '45352', '2026-3-1', '1.3.2026', '2026.03.01'])(
    'третья форма даты не угадывается: %s',
    (value) => {
      expect(() => parseDate(value, at)).toThrow(CellError)
    },
  )

  test('пустая дата — отказ: строка без даты не попадёт ни в один месяц', () => {
    expect(refusal(() => parseDate('', at)).message).toMatch(/не заполнен/i)
    expect(refusal(() => parseDate('   ', at)).message).toMatch(/не заполнен/i)
  })

  test('отказ называет место, значение и что делать', () => {
    const error = refusal(() => parseDate('1 марта', at))
    expect(error.message).toContain('в листе orders')
    expect(error.message).toContain('строка 7')
    expect(error.message).toContain('date')
    expect(error.message).toContain('1 марта')
    // «что делать» — обе принимаемые формы названы в тексте отказа
    expect(error.message).toMatch(/2026-03-01|ГГГГ-ММ-ДД/)
    expect(error.message).toMatch(/01\.03\.2026|ДД\.ММ\.ГГГГ/)
  })

  test('отказ несёт адрес отдельными полями, а не только текстом', () => {
    const error = refusal(() => parseDate('1 марта', at))
    expect(error.address).toEqual(at)
  })
})

describe('месяц', () => {
  const month = { source: 'в листе opex', rowNo: 2, column: 'month' }

  test('обе формы месяца дают первый день месяца', () => {
    expect(parseMonth('2026-03', month)).toBe('2026-03-01')
    expect(parseMonth('03.2026', month)).toBe('2026-03-01')
  })

  test.each(['2026-13', '13.2026', '2026-00', 'март 2026', '2026-03-01'])(
    'непонятый месяц — отказ: %s',
    (value) => {
      expect(() => parseMonth(value, month)).toThrow(CellError)
    },
  )

  test('пустой месяц — свой отказ, а не «не разобран»', () => {
    // Без проверки текста этот отказ можно было убрать: значение провалилось бы в соседний,
    // про неразобранную форму, и красное осталось бы — но человеку сказали бы не то.
    const error = refusal(() => parseMonth('', month))
    expect(error.message).toMatch(/не заполнен/i)
    expect(error.message).toMatch(/2026-03|03\.2026/)
  })
})

describe('число', () => {
  const amount = { source: 'в листе orders', rowNo: 7, column: 'gross_eur' }

  test('точка и запятая — одно и то же число', () => {
    expect(parseAmount('24.90', amount, 2)).toBe('24.90')
    expect(parseAmount('24,90', amount, 2)).toBe('24.90')
  })

  test('пробел-разделитель тысяч снимается во всех трёх написаниях', () => {
    expect(parseAmount('1 234,50', amount, 2)).toBe('1234.50')
    expect(parseAmount('1 234,50', amount, 2)).toBe('1234.50')
    expect(parseAmount('1 234,50', amount, 2)).toBe('1234.50')
  })

  test('неоднозначная расстановка двух разделителей — свой отказ', () => {
    // «1.2,3.4» — оба вида разделителя, и десятичный встречается дважды. Без проверки
    // текста этот отказ проваливался бы в общий «не похоже на число».
    const error = refusal(() => parseAmount('1.2,3.4', amount, 2))
    expect(error.message).toMatch(/не читается однозначно/)
  })

  test('при двух разделителях десятичный — последний', () => {
    expect(parseAmount('1.234,50', amount, 2)).toBe('1234.50')
    expect(parseAmount('1,234.50', amount, 2)).toBe('1234.50')
    expect(parseAmount('1.234.567,89', amount, 2)).toBe('1234567.89')
  })

  test('целое без дробной части разбирается', () => {
    expect(parseAmount('78', amount, 2)).toBe('78')
    expect(parseAmount('0', amount, 2)).toBe('0')
  })

  test('знак минус доезжает как есть: источник не чинится', () => {
    expect(parseAmount('-5,00', amount, 2)).toBe('-5.00')
  })

  test('лишние знаки после запятой — отказ, а не молчаливое округление', () => {
    // «1,234» — это тысяча двести тридцать четыре или единица с хвостом? Разбор
    // не гадает: округлив, он записал бы в факты не то число, что в источнике.
    const error = refusal(() => parseAmount('1,234', amount, 2))
    expect(error.message).toContain('1,234')
    expect(error.message).toMatch(/знак/i)
    expect(() => parseAmount('24.905', amount, 2)).toThrow(CellError)
  })

  test('у курса шесть знаков, у процента четыре — и это разные пределы', () => {
    expect(parseAmount('1.0529', { ...amount, column: 'usd_per_eur' }, 6)).toBe('1.0529')
    expect(parseAmount('1.900', { ...amount, column: 'percent' }, 4)).toBe('1.900')
    expect(() => parseAmount('1.0529', amount, 2)).toThrow(CellError)
  })

  test('повторённый одиночный разделитель не угадывается', () => {
    // «12.5.3» и «1.234.567» без второго вида разделителя двусмысленны:
    // где здесь тысячи, а где копейки, известно только человеку.
    //
    // Проверяется текст отказа, а не сам факт отказа. Без этого проверка зеленела бы на
    // чужом отказе: убери разбор этого случая — и значение упрётся в общую проверку формы
    // числа, которая скажет «не похоже на число». Отказ случится, но человеку он назовёт
    // не ту беду и не то действие.
    for (const value of ['12.5.3', '1.234.567']) {
      const error = refusal(() => parseAmount(value, amount, 2))
      expect(error.message).toContain(value)
      expect(error.message).toMatch(/разделитель повторяется/)
      expect(error.message).toMatch(/одним разделителем/)
    }
  })

  test.each(['abc', '-', '12,', ',50', '1 2', '12€', '1e3'])(
    'непонятое число — отказ: %s',
    (value) => {
      expect(() => parseAmount(value, amount, 2)).toThrow(CellError)
    },
  )

  test('пустая денежная ячейка — это «нет данных», а не ноль и не отказ', () => {
    expect(parseAmount('', amount, 2)).toBeNull()
    expect(parseAmount('   ', amount, 2)).toBeNull()
    expect(parseAmount(null, amount, 2)).toBeNull()
  })

  test('деньги возвращаются строкой, а не числом', () => {
    // Число в JavaScript — двоичная дробь: 0.1 + 0.2 не равно 0.3. Вернув число,
    // разбор отдал бы драйверу уже испорченное значение, и починить его было бы негде.
    expect(typeof parseAmount('24,90', amount, 2)).toBe('string')
    expect(parseAmount('0.1', amount, 2)).toBe('0.1')
  })
})

describe('штуки', () => {
  const units = { source: 'в листе orders', rowNo: 7, column: 'units' }

  test('целое число штук разбирается', () => {
    expect(parseUnits('1', units)).toBe(1)
    expect(parseUnits('3', units)).toBe(3)
  })

  test.each(['0', '-1', '2.5', '2,5', 'две'])('не штуки — отказ: %s', (value) => {
    expect(() => parseUnits(value, units)).toThrow(CellError)
  })

  test('пустое количество — свой отказ, а не «должно быть целым»', () => {
    const error = refusal(() => parseUnits('', units))
    expect(error.message).toMatch(/не заполнено/i)
  })

  test('отказ на нуле говорит, что строка с нулём штук не продажа', () => {
    expect(refusal(() => parseUnits('0', units)).message).toMatch(/строка 7/)
  })
})

describe('артикул', () => {
  const sku = { source: 'в листе orders', rowNo: 7, column: 'sku' }

  test('три написания одного товара из источника сходятся в одно', () => {
    // Ровно те три, что лежат в листе orders: обычное, строчными и с неразрывным дефисом.
    expect(parseSku('NP-003', sku)).toBe('NP-003')
    expect(parseSku('np-003 ', sku)).toBe('NP-003')
    expect(parseSku('NP‑003', sku)).toBe('NP-003')
  })

  test('прочие дефисы-не-дефисы тоже приводятся', () => {
    for (const dash of ['‐', '‒', '–', '—', '―', '−']) {
      expect(parseSku(`NP${dash}003`, sku)).toBe('NP-003')
    }
  })

  test('пробелы снимаются все, а не только крайние', () => {
    expect(parseSku(' NP-003 ', sku)).toBe('NP-003')
    expect(parseSku('NP- 003', sku)).toBe('NP-003')
    expect(parseSku('NP-003 ', sku)).toBe('NP-003')
  })

  test('пустой артикул — отказ: строка без товара не ложится ни в один столбец экрана', () => {
    expect(() => parseSku('', sku)).toThrow(CellError)
    expect(() => parseSku('  ', sku)).toThrow(CellError)
  })
})

describe('обязательный текст', () => {
  const gateway = { source: 'в листе orders', rowNo: 7, column: 'gateway' }

  test('крайние пробелы снимаются: иначе «card » и «card» стали бы разными шлюзами', () => {
    expect(requireText('card', gateway)).toBe('card')
    expect(requireText(' card ', gateway)).toBe('card')
  })

  test('регистр не трогается: это не артикул', () => {
    expect(requireText('PayPal', gateway)).toBe('PayPal')
  })

  test('пустое значение — отказ, называющий столбец', () => {
    expect(refusal(() => requireText('', gateway)).message).toContain('gateway')
    expect(() => requireText(null, gateway)).toThrow(CellError)
  })
})
