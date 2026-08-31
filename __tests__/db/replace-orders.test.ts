import { afterAll, expect, test } from 'vitest'

import { inRollback, pool } from './support'

afterAll(() => pool.end())

/** Снимок листа как его отдаёт Google: всё строками, вместе с кривизной. */
const fiveRows = [
  {
    row_no: 1,
    date: '01.03.2026',
    order_id: 'A-1',
    sku: 'NP-001',
    units: '1',
    gross_eur: '10,00',
    discount_eur: '',
    gateway: 'stripe',
  },
  {
    row_no: 2,
    date: '2026-03-01',
    order_id: 'A-2',
    sku: 'np-002 ',
    units: '2',
    gross_eur: '20,00',
    discount_eur: '1,00',
    gateway: 'paypal',
  },
  {
    row_no: 3,
    date: '02.03.2026',
    order_id: 'A-3',
    sku: 'NP-003',
    units: '1',
    gross_eur: '30,00',
    discount_eur: '',
    gateway: 'stripe',
  },
  {
    row_no: 4,
    date: '2026-03-02',
    order_id: 'A-4',
    sku: 'NP-001',
    units: '3',
    gross_eur: '40,00',
    discount_eur: '',
    gateway: 'stripe',
  },
  {
    row_no: 5,
    date: '03.03.2026',
    order_id: 'A-5',
    sku: 'NP-002',
    units: '1',
    gross_eur: '50,00',
    discount_eur: '',
    gateway: 'paypal',
  },
]

const snapshot = (rows: unknown[]) => JSON.stringify(rows)

test('снимок записывается, а кривизна источника переживает запись', async () => {
  await inRollback(async (client) => {
    await client.query('select raw.replace_orders($1::jsonb)', [snapshot(fiveRows)])

    const { rows } = await client.query('select row_no, sku, date from raw.orders order by row_no')
    expect(rows).toHaveLength(5)
    // хвостовой пробел и обе формы даты доезжают нетронутыми: сырой слой не чинит источник
    expect(rows[1].sku).toBe('np-002 ')
    expect(rows.map((r) => r.date)).toContain('01.03.2026')
    expect(rows.map((r) => r.date)).toContain('2026-03-01')
  })
})

// Сравнение строк идёт в самой базе, а не в JavaScript. Драйвер отдаёт timestamptz
// объектом Date с точностью до миллисекунды, а PostgreSQL хранит микросекунды: две записи
// в пределах одной миллисекунды стали бы в JavaScript неразличимы, и проверка позеленела бы
// на сломанном механизме.
test('тот же снимок дважды подряд не меняет ни одного байта', async () => {
  await inRollback(async (client) => {
    await client.query('select raw.replace_orders($1::jsonb)', [snapshot(fiveRows)])
    await client.query('create temporary table before_state on commit drop as table raw.orders')

    await client.query('select raw.replace_orders($1::jsonb)', [snapshot(fiveRows)])

    const { rows: difference } = await client.query(
      `select 'пропало' as side, row_no from (table before_state except table raw.orders) a
       union all
       select 'появилось', row_no from (table raw.orders except table before_state) b
       order by 1, 2`,
    )
    // сравниваются строки целиком, включая updated_at: ни одна колонка не исключена
    expect(difference).toEqual([])
  })
})

test('исчезнувший из источника адрес исчезает из таблицы', async () => {
  await inRollback(async (client) => {
    await client.query('select raw.replace_orders($1::jsonb)', [snapshot(fiveRows)])
    await client.query('select raw.replace_orders($1::jsonb)', [snapshot(fiveRows.slice(0, 3))])

    const { rows } = await client.query('select row_no from raw.orders order by row_no')
    expect(rows.map((r) => r.row_no)).toEqual([1, 2, 3])
  })
})

test('изменившееся значение всё-таки записывается', async () => {
  await inRollback(async (client) => {
    await client.query('select raw.replace_orders($1::jsonb)', [snapshot(fiveRows)])
    const changed = fiveRows.map((r) => (r.row_no === 1 ? { ...r, units: '9' } : r))

    await client.query('select raw.replace_orders($1::jsonb)', [snapshot(changed)])

    const { rows } = await client.query('select units from raw.orders where row_no = 1')
    expect(rows[0].units).toBe('9')
  })
})

test('изменившаяся строка обновляет своё время, соседние — нет', async () => {
  await inRollback(async (client) => {
    await client.query('select raw.replace_orders($1::jsonb)', [snapshot(fiveRows)])
    await client.query(
      'create temporary table before_state on commit drop as select row_no, updated_at from raw.orders',
    )

    const changed = fiveRows.map((r) => (r.row_no === 1 ? { ...r, units: '9' } : r))
    await client.query('select raw.replace_orders($1::jsonb)', [snapshot(changed)])

    // сравнение времени тоже в базе: в JavaScript микросекунды теряются
    const { rows: touched } = await client.query(
      `select o.row_no
         from raw.orders o join before_state b using (row_no)
        where o.updated_at is distinct from b.updated_at
        order by o.row_no`,
    )
    expect(touched.map((r) => r.row_no)).toEqual([1])
  })
})

test('пустой снимок отвергается, а не вычищает таблицу', async () => {
  await inRollback(async (client) => {
    await client.query('select raw.replace_orders($1::jsonb)', [snapshot(fiveRows)])

    await expect(client.query(`select raw.replace_orders('[]'::jsonb)`)).rejects.toThrow(
      /пустой снимок/,
    )
  })
})

// Каждый отказ — в своей транзакции: в PostgreSQL упавший оператор рвёт транзакцию целиком,
// и следующий запрос в ней получил бы «транзакция уже прервана» вместо своего сообщения.
test.each([
  ["не-массив", `select raw.replace_orders('{}'::jsonb)`],
  ['null вместо снимка', 'select raw.replace_orders(null)'],
])('%s тоже отвергается', async (_name, sql) => {
  await inRollback(async (client) => {
    await expect(client.query(sql)).rejects.toThrow(/пустой снимок/)
  })
})
