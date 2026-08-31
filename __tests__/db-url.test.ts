import { spawnSync } from 'node:child_process'

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
    ['options', 'postgresql://postgres@127.0.0.1:5432/nordic_pet?options=-c%20search_path=x'],
  ])('отвергает подмену через параметр %s', (_name, url) => {
    expect(() => assertProjectDatabase(url)).toThrow(/запрещён параметр/)
  })

  // Решётку разбор адреса отрезает, а клиент базы — нет.
  it('отвергает подмену через решётку', () => {
    expect(() =>
      assertProjectDatabase('postgresql://postgres@127.0.0.1:5432/nordic_pet#?dbname=hospital'),
    ).toThrow(/решётк/)
  })

  it('отвергает другой порт на том же хосте: другой порт — другой сервер', () => {
    expect(() => assertProjectDatabase('postgresql://postgres@127.0.0.1:6543/nordic_pet')).toThrow(
      /порт/,
    )
  })

  // То, чего в адресе нет, клиент базы берёт из окружения: при пустом порте — из PGPORT.
  // Подставлять за автора 5432 значит разрешить адрес, который ведёт на другой сервер.
  it('отвергает адрес без порта: порт возьмётся из окружения', () => {
    expect(() => assertProjectDatabase('postgresql://postgres@127.0.0.1/nordic_pet')).toThrow(
      /порт, взятый из окружения/,
    )
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

describe('команда пересоздания базы', () => {
  /**
   * Утверждения выше проверяют саму защиту. Это — что разрушающая команда через неё ходит:
   * без такой проверки защиту можно вынуть из скрипта, и все прочие останутся зелёными.
   *
   * Адрес нарочно указывает на порт, где никто не слушает, и на несуществующее имя базы:
   * если защиту вынут, команда упрётся в отсутствующий сервер, а не снесёт чью-то работу.
   * Отличаем одно от другого по тексту отказа.
   */
  it('отказывается работать с чужим адресом, а не выполняет его', () => {
    const run = spawnSync('node', ['scripts/db-reset.ts'], {
      env: { ...process.env, DATABASE_URL: 'postgresql://postgres@127.0.0.1:1/чужая_база' },
      encoding: 'utf8',
    })

    expect(run.status).toBe(1)
    expect(`${run.stderr}${run.stdout}`).toMatch(/пересоздание базы отменено/)
  })
})
