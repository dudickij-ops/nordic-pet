import { afterEach, describe, expect, it } from 'vitest'

import { assertProjectDatabase, projectDatabaseUrl } from '@/lib/db-url'

const LOCAL = 'postgresql://postgres@127.0.0.1:5432/nordic_pet?sslmode=disable'

describe('адрес базы проекта', () => {
  it('пропускает базу проекта на локальном хосте', () => {
    expect(assertProjectDatabase(LOCAL)).toBe(LOCAL)
  })

  it('пропускает localhost и ::1 — это тот же локальный хост', () => {
    expect(() =>
      assertProjectDatabase('postgresql://postgres@localhost:5432/nordic_pet'),
    ).not.toThrow()
    expect(() => assertProjectDatabase('postgresql://postgres@[::1]:5432/nordic_pet')).not.toThrow()
  })

  // На сервере владельца тринадцать баз, и двенадцать из них — чужие работы.
  // Опечатка в переменной окружения не должна стоить чужой базы.
  it.each(['hospital', 'unimed', 'educational_platform', 'sys_lab', 'postgres'])(
    'отказывается работать с чужой базой %s',
    (name) => {
      expect(() => assertProjectDatabase(`postgresql://postgres@127.0.0.1:5432/${name}`)).toThrow(
        /nordic_pet/,
      )
    },
  )

  it('отказывается работать с удалённым хостом', () => {
    expect(() =>
      assertProjectDatabase('postgresql://postgres:pw@db.abcdefgh.supabase.co:5432/nordic_pet'),
    ).toThrow(/локальн/)
  })

  it('отказывается, когда база не названа вовсе', () => {
    expect(() => assertProjectDatabase('postgresql://postgres@127.0.0.1:5432/')).toThrow()
  })

  it('отказывается от того, что вообще не адрес', () => {
    expect(() => assertProjectDatabase('не адрес')).toThrow()
  })

  it('называет в ошибке ту базу, которую отверг', () => {
    expect(() => assertProjectDatabase('postgresql://postgres@127.0.0.1:5432/hospital')).toThrow(
      /hospital/,
    )
  })
})

describe('адрес, которым пользуется проект', () => {
  const original = process.env.DATABASE_URL

  afterEach(() => {
    if (original === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = original
  })

  // Вызов без единого аргумента, на настоящем окружении: именно так его зовут проверки
  // и пересоздание базы, и именно этот путь обязан быть проверен.
  it('на настоящем окружении указывает на базу проекта', () => {
    expect(projectDatabaseUrl()).toContain('/nordic_pet')
  })

  it('отказывается, когда в окружении подставлена чужая база', () => {
    process.env.DATABASE_URL = 'postgresql://postgres@127.0.0.1:5432/hospital'
    expect(() => projectDatabaseUrl()).toThrow(/hospital/)
  })
})
