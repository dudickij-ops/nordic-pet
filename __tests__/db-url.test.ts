import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { assertProjectDatabase, clearPostgresEnvironment, projectDatabaseUrl } from '@/lib/db-url'

const LOCAL = 'postgresql://postgres@127.0.0.1:5432/nordic_pet?sslmode=disable'

describe('адрес базы проекта', () => {
  it('пропускает базу проекта на локальном хосте', () => {
    expect(assertProjectDatabase(LOCAL)).toBe(LOCAL)
  })

  it('пропускает localhost и ::1 — это тот же локальный хост', () => {
    expect(assertProjectDatabase('postgresql://postgres@localhost:5432/nordic_pet')).toBe(
      'postgresql://postgres@localhost:5432/nordic_pet?sslmode=disable',
    )
    expect(assertProjectDatabase('postgresql://postgres@[::1]:5432/nordic_pet')).toBe(
      'postgresql://postgres@[::1]:5432/nordic_pet?sslmode=disable',
    )
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

  it('называет в ошибке ту базу, которую отверг', () => {
    expect(() => assertProjectDatabase('postgresql://postgres@127.0.0.1:5432/hospital')).toThrow(
      /hospital/,
    )
  })

  it('отказывается работать с удалённым хостом', () => {
    expect(() =>
      assertProjectDatabase('postgresql://postgres:pw@db.abcdefgh.supabase.co:5432/nordic_pet'),
    ).toThrow(/локальн/)
  })

  it('отказывается от того, что вообще не адрес', () => {
    expect(() => assertProjectDatabase('не адрес')).toThrow(/не разбирается/)
  })

  it('отказывается от чужой схемы адреса', () => {
    expect(() => assertProjectDatabase('mysql://postgres@127.0.0.1:5432/nordic_pet')).toThrow(
      /postgresql/,
    )
  })

  // Пять частей адреса, каждая из которых обязана быть названа явно. Всё, чего в адресе
  // нет, клиент базы берёт из окружения: PGHOST, PGPORT, PGDATABASE, PGUSER, pg_service.conf.
  // Умолчание, подставленное защитой за автора, — это и есть дыра: проверенным окажется
  // одно, а поедет соединение по другому.
  describe('каждая часть адреса обязана быть названа явно', () => {
    it('отказывается, когда хост не назван: он взялся бы из PGHOST', () => {
      expect(() => assertProjectDatabase('postgresql:///nordic_pet')).toThrow(/не назван хост/)
    })

    it('отказывается, когда порт не назван: он взялся бы из PGPORT', () => {
      expect(() => assertProjectDatabase('postgresql://postgres@127.0.0.1/nordic_pet')).toThrow(
        /не назван порт/,
      )
    })

    it('отказывается, когда база не названа: она взялась бы из PGDATABASE', () => {
      expect(() => assertProjectDatabase('postgresql://postgres@127.0.0.1:5432/')).toThrow(
        /не названа база/,
      )
    })

    it('отказывается, когда пользователь не назван: он взялся бы из PGUSER', () => {
      expect(() => assertProjectDatabase('postgresql://127.0.0.1:5432/nordic_pet')).toThrow(
        /не назван пользователь/,
      )
    })

    it('отказывается от имени пользователя, которое пришлось бы перекодировать', () => {
      expect(() => assertProjectDatabase('postgresql://po%73tgres@127.0.0.1:5432/nordic_pet')).toThrow(
        /пользовател/,
      )
    })
  })

  it('отвергает другой порт на том же хосте: другой порт — другой сервер', () => {
    expect(() => assertProjectDatabase('postgresql://postgres@127.0.0.1:6543/nordic_pet')).toThrow(
      /порт/,
    )
  })

  // Главное свойство новой конструкции: наружу отдаётся не тот адрес, что дали, а собранный
  // заново из пяти проверенных частей. Поэтому подменять нечего — хвост не проверяется
  // по списку известных обходов, он просто не доезжает до клиента базы.
  describe('отдаёт адрес, собранный заново, а не тот, что дали', () => {
    it.each([
      ['dbname', 'postgresql://postgres@127.0.0.1:5432/nordic_pet?dbname=hospital'],
      ['host', 'postgresql://postgres@127.0.0.1:5432/nordic_pet?host=192.0.2.1'],
      ['port', 'postgresql://postgres@127.0.0.1:5432/nordic_pet?port=5999'],
      ['service', 'postgresql://postgres@127.0.0.1:5432/nordic_pet?service=прод'],
      ['options', 'postgresql://postgres@127.0.0.1:5432/nordic_pet?options=-c%20search_path=x'],
      ['решётка', 'postgresql://postgres@127.0.0.1:5432/nordic_pet#?dbname=hospital'],
      ['пароль', 'postgresql://postgres:pw@127.0.0.1:5432/nordic_pet'],
      ['неизвестный завтра', 'postgresql://postgres@127.0.0.1:5432/nordic_pet?ещё_не_придуманный=1'],
    ])('выбрасывает %s, а не разбирается, опасен ли он', (_name, url) => {
      expect(assertProjectDatabase(url)).toBe(LOCAL)
    })

    it('схему адреса тоже отдаёт свою, а не ту, что дали', () => {
      expect(assertProjectDatabase('postgres://postgres@127.0.0.1:5432/nordic_pet')).toBe(LOCAL)
    })
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

  it('вычищает хвост и из адреса, пришедшего окружением', () => {
    process.env.DATABASE_URL = 'postgresql://postgres@127.0.0.1:5432/nordic_pet?dbname=hospital'
    expect(projectDatabaseUrl()).toBe(LOCAL)
  })
})

// Второй замок. Даже безупречный адрес не спасает, если клиент базы дочитывает недостающее
// из окружения: PGDATABASE, PGHOST, PGPORT, PGUSER, PGSERVICEFILE. Разрушающая команда
// обязана уходить в окружение, где подставлять нечего.
describe('окружение дочернего процесса', () => {
  const saved = { ...process.env }

  afterEach(() => {
    for (const key of Object.keys(process.env)) if (key.startsWith('PG')) delete process.env[key]
    for (const [key, value] of Object.entries(saved)) if (key.startsWith('PG')) process.env[key] = value
  })

  it('снимает все переменные PG*, а остальные оставляет', () => {
    const env = {
      PGDATABASE: 'hospital',
      PGHOST: '192.0.2.1',
      PGPORT: '6543',
      PGUSER: 'чужой',
      PGSERVICEFILE: '/tmp/pg_service.conf',
      PGSSLMODE: 'require',
      PATH: '/usr/bin',
      DATABASE_URL: 'postgresql://postgres@127.0.0.1:5432/nordic_pet',
    }

    expect(clearPostgresEnvironment(env)).toEqual({
      PATH: '/usr/bin',
      DATABASE_URL: 'postgresql://postgres@127.0.0.1:5432/nordic_pet',
    })
  })

  // Вызов без аргументов, на настоящем окружении процесса: именно так его зовёт
  // пересоздание базы, и именно этот путь обязан быть проверен.
  it('без аргументов чистит настоящее окружение процесса', () => {
    process.env.PGDATABASE = 'hospital'
    clearPostgresEnvironment()
    expect(process.env.PGDATABASE).toBeUndefined()
  })
})

describe('команда пересоздания базы', () => {
  const trash: string[] = []

  afterEach(() => {
    for (const path of trash.splice(0)) rmSync(path, { recursive: true, force: true })
  })

  /** Подкладывает в PATH подставную `supabase`, которая запишет свои аргументы и своё окружение. */
  function stubSupabase(): { path: string; dump: string; read: () => string } {
    const dir = mkdtempSync(join(tmpdir(), 'nordic-pet-'))
    trash.push(dir)
    const dump = join(dir, 'вызов.txt')
    const stub = join(dir, 'supabase')
    writeFileSync(stub, `#!/bin/sh\n{ echo "аргументы: $*"; env | grep '^PG'; } > "$NORDIC_PET_DUMP"\nexit 3\n`)
    chmodSync(stub, 0o755)
    return { path: dir, dump, read: () => readFileSync(dump, 'utf8') }
  }

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

  it('уходит в окружение, где подставлять нечего: ни одной переменной PG*', () => {
    const stub = stubSupabase()

    const run = spawnSync('node', ['scripts/db-reset.ts'], {
      env: {
        ...process.env,
        PATH: `${stub.path}:${process.env.PATH}`,
        NORDIC_PET_DUMP: stub.dump,
        DATABASE_URL: LOCAL,
        PGDATABASE: 'hospital',
        PGHOST: '192.0.2.1',
        PGPORT: '6543',
        PGUSER: 'чужой',
        PGSERVICEFILE: '/tmp/pg_service.conf',
      },
      encoding: 'utf8',
    })

    // Подставная команда выходит с кодом 3 — до настоящей базы дело не доходит.
    expect(run.status).toBe(3)
    expect(stub.read()).not.toMatch(/^PG/m)
  })

  it('передаёт команде пересоздания адрес, собранный защитой заново', () => {
    const stub = stubSupabase()

    spawnSync('node', ['scripts/db-reset.ts'], {
      env: {
        ...process.env,
        PATH: `${stub.path}:${process.env.PATH}`,
        NORDIC_PET_DUMP: stub.dump,
        DATABASE_URL: 'postgresql://postgres@127.0.0.1:5432/nordic_pet?dbname=hospital',
      },
      encoding: 'utf8',
    })

    expect(stub.read()).toContain(`аргументы: db reset --yes --db-url ${LOCAL}`)
  })
})
