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

  // Проверять хост и путь мало: по правилам libpq параметры строки запроса перекрывают
  // и то, и другое. Адрес ниже с виду указывает на nordic_pet, а соединяется с hospital.
  it.each([
    ['dbname', 'postgresql://postgres@127.0.0.1:5432/nordic_pet?dbname=hospital'],
    ['host', 'postgresql://postgres@127.0.0.1:5432/nordic_pet?host=192.0.2.1'],
    ['port', 'postgresql://postgres@127.0.0.1:5432/nordic_pet?port=5999'],
    ['service', 'postgresql://postgres@127.0.0.1:5432/nordic_pet?service=прод'],
  ])('отвергает подмену через параметр %s', (_name, url) => {
    expect(() => assertProjectDatabase(url)).toThrow(/запрещён параметр/)
  })

  it('пропускает sslmode — он ничего не перекрывает', () => {
    expect(() => assertProjectDatabase(LOCAL)).not.toThrow()
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
