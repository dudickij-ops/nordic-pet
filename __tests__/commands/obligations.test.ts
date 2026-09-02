import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, test } from 'vitest'

import {
  DATABASE_COMMANDS,
  NOT_A_COMMAND,
  type DatabaseCommand,
  type ProbeClient,
  type Probes,
} from '@/lib/commands'
import { blockNetwork } from './network'

/**
 * Обязательства всякой команды, ходящей в базу.
 *
 * Список обязательств один на проект, и новая команда проходит его самим фактом того, что
 * она записана в `lib/commands.ts`. Прежде эти же требования жили прозой в правилах, и
 * дважды подряд — в S3 и в S4 — их находил рецензент, а не проверка: снятие переменных
 * `PG*`, называние цели до работы, запуск простым `node`. Проза не проверяется.
 *
 * Сами обязательства тоже держатся списком, а не набором отдельных проверок: вырезанное
 * обязательство прежде оставляло набор зелёным — их никто не считал.
 *
 * Ни одна проверка здесь не ходит ни в базу, ни в сеть: соединение записывает момент и
 * обрывает работу, внешний мир отдаёт заготовленный ответ.
 */

function probes(): Probes {
  const timeline: string[] = []
  return {
    timeline,
    announce: (line) => {
      timeline.push(`цель: ${line}`)
    },
    connect: async (): Promise<ProbeClient> => {
      // Момент соединения записывается вместе с тем, что в этот момент лежало в окружении:
      // обязательство про PG* проверяется именно здесь и никак иначе.
      timeline.push(`соединение, PGHOST=${process.env.PGHOST ?? 'снят'}`)
      throw new Error('дальше проверка не пускает: до базы дело не доходит')
    },
    outside: (world, answer) => {
      timeline.push(`внешний мир: ${world}`)
      return answer
    },
  }
}

/** Зовёт команду с зацепками и отдаёт ленту событий. Отказ ожидаем: соединение обрывает работу. */
async function timelineOf(command: DatabaseCommand): Promise<string[]> {
  const probe = probes()
  await command.run(probe).catch(() => {})
  return probe.timeline
}

function runScript(command: DatabaseCommand, env: Record<string, string>) {
  return spawnSync(process.execPath, [command.script], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
}

/** Выполняет тело, пока среда названа, и возвращает окружение как было. */
async function withTarget(run: () => Promise<void> | void): Promise<void> {
  const saved = process.env.NORDIC_PET_DB_TARGET
  process.env.NORDIC_PET_DB_TARGET = 'local'
  try {
    await run()
  } finally {
    if (saved === undefined) delete process.env.NORDIC_PET_DB_TARGET
    else process.env.NORDIC_PET_DB_TARGET = saved
  }
}

type Obligation = {
  name: string
  check: (command: DatabaseCommand) => Promise<void> | void
}

const OBLIGATIONS: Obligation[] = [
  {
    name: 'запускается простым node',
    check: (command) => {
      // Сокращение `@/` понимают vitest и Next, но не `node`. Команда с таким сокращением
      // проходит все проверки и падает на первом настоящем запуске.
      //
      // Средой здесь названа бессмыслица, а не пустота, и это не мелочь: пустую среду
      // сторожит соседнее обязательство, и если оба опирались бы на один и тот же отказ,
      // слом одного краснил бы проверку другого. Ровно это и случилось на первом прогоне.
      const run = runScript(command, { NORDIC_PET_DB_TARGET: 'куда-нибудь' })
      expect(run.stderr).not.toContain('ERR_MODULE_NOT_FOUND')
      expect(run.stderr).not.toContain('Cannot find package')
      expect(run.stderr).toContain(command.refusal)
      expect(run.status).toBe(1)
    },
  },
  {
    name: 'неназванная среда — отказ',
    check: (command) => {
      // Угадывать среду по косвенным признакам нельзя: ошибка вскроется записью не в ту базу.
      const run = runScript(command, { NORDIC_PET_DB_TARGET: '' })
      expect(run.stderr).toContain('NORDIC_PET_DB_TARGET')
      expect(run.stderr).toContain(command.refusal)
      expect(run.stdout).toBe('')
      expect(run.status).toBe(1)
    },
  },
  {
    name: 'цель названа до первой работы',
    check: (command) =>
      withTarget(async () => {
        const timeline = await timelineOf(command)

        // Команда обязана дойти до соединения: иначе проверка зеленела бы от того,
        // что работы не было вовсе.
        const connected = timeline.findIndex((event) => event.startsWith('соединение'))
        expect(connected, `команда ${command.name} не дошла до соединения`).toBeGreaterThanOrEqual(
          0,
        )

        const named = timeline.findIndex((event) => event.startsWith('цель:'))
        expect(named).toBe(0)
        expect(named).toBeLessThan(connected)
      }),
  },
  {
    name: 'переменные PG* сняты до соединения',
    check: async (command) => {
      // Драйвер читает те же переменные, что и libpq: оставленный `PGHOST` — это чужой
      // адрес, подставленный с другой стороны, и запись ушла бы не в ту базу молча.
      const savedHost = process.env.PGHOST
      process.env.PGHOST = 'подставной-хост'
      try {
        await withTarget(async () => {
          const timeline = await timelineOf(command)
          const connection = timeline.find((event) => event.startsWith('соединение'))
          expect(connection, `команда ${command.name} не дошла до соединения`).toBeDefined()
          expect(connection).toBe('соединение, PGHOST=снят')
        })
      } finally {
        if (savedHost === undefined) delete process.env.PGHOST
        else process.env.PGHOST = savedHost
      }
    },
  },
  {
    name: 'за работу не стучится наружу ни разу',
    check: (command) =>
      withTarget(async () => {
        // Наблюдение вместо чтения кода. Выход наружу перекрыт целиком, объявленный
        // внешний мир подменён заготовленным ответом — значит всякий стук в сеть означает
        // поход, о котором команда не объявляла. Реэкспорт, динамический импорт и голый
        // `fetch` разбором импортов не ловились; ловушкой ловятся все три и всё, что
        // появится завтра.
        const blocked = blockNetwork({ allowLocalDatabase: false })
        try {
          // Сперва убеждаемся, что ловушка ловит: иначе «стуков нет» ничего не доказывает.
          blocked.proveTrapWorks()

          const probe = probes()
          await command.run(probe).catch(() => {})

          expect(blocked.knocks, `команда ${command.name} стучалась наружу`).toEqual([])
          expect(probe.timeline.some((event) => event.startsWith('соединение'))).toBe(true)

          // Объявление обязано быть точным в обе стороны. Мир, объявленный «на всякий
          // случай», через год окажется единственным следом того, куда команда ходит,
          // и соврёт. Проверяется по тому, за каким миром команда вправду сходила.
          const visited = probe.timeline
            .filter((event) => event.startsWith('внешний мир: '))
            .map((event) => event.replace('внешний мир: ', ''))
          expect([...new Set(visited)].sort()).toEqual([...command.outsideWorld].sort())
        } finally {
          blocked.restore()
        }
      }),
  },
]

describe.each(DATABASE_COMMANDS)('обязательства команды $name', (command) => {
  test.each(OBLIGATIONS)('$name', async ({ check }) => {
    await check(command)
  })
})

describe('список обязательств', () => {
  test('обязательств ровно пять, и они те самые', () => {
    // Обязательства держатся списком, а не набором отдельных проверок. Вырезанное
    // обязательство прежде оставляло набор зелёным: их никто не считал.
    expect(OBLIGATIONS.map((one) => one.name)).toEqual([
      'запускается простым node',
      'неназванная среда — отказ',
      'цель названа до первой работы',
      'переменные PG* сняты до соединения',
      'за работу не стучится наружу ни разу',
    ])
  })
})

describe('список команд', () => {
  test('каждый сценарий либо команда, либо назван не командой с причиной', () => {
    // Без этого замка список — тот же чек-лист, который уже дважды не сработал: новая
    // команда просто не попала бы в него, и обязательства остались бы непроверенными.
    //
    // Обход идёт вглубь и по всем расширениям: подкаталог `scripts/tools/` и файл `.mjs`
    // прежде проходили незамеченными.
    const scripts: string[] = []
    const walk = (directory: string) => {
      for (const name of readdirSync(directory)) {
        const path = join(directory, name)
        if (statSync(path).isDirectory()) walk(path)
        else if (/\.(ts|mts|cts|js|mjs|cjs)$/.test(name)) scripts.push(relative('.', path))
      }
    }
    walk('scripts')

    const known = new Set([
      ...DATABASE_COMMANDS.map((command) => command.script),
      ...Object.keys(NOT_A_COMMAND),
    ])

    expect(scripts.filter((script) => !known.has(script))).toEqual([])
  })

  test('ни одна команда package.json не заводит сценарий в обход списка', () => {
    // Второй вход: сценарий можно положить и вне каталога `scripts/`. Тогда его выдаёт
    // строка запуска в package.json.
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>
    }
    const known = new Set([
      ...DATABASE_COMMANDS.map((command) => command.script),
      ...Object.keys(NOT_A_COMMAND),
    ])

    const hidden: string[] = []
    for (const [name, line] of Object.entries(packageJson.scripts)) {
      // Ищется то, что запускает `node`, — первый его довод, не начинающийся с чёрточки.
      // Не всякий путь в строке: `--config vitest.live.config.ts` это настройка, а не
      // команда, и путать одно с другим значит либо пропускать команды, либо ругаться
      // на настройки.
      const words = line.trim().split(/\s+/)
      const node = words.indexOf('node')
      if (node === -1) continue
      const entry = words.slice(node + 1).find((word) => !word.startsWith('-'))
      if (entry === undefined || entry.startsWith('node_modules/')) continue
      if (!known.has(entry)) hidden.push(`${name} → ${entry}`)
    }
    expect(hidden).toEqual([])
  })

  test('у каждого исключения названа причина', () => {
    for (const [script, reason] of Object.entries(NOT_A_COMMAND)) {
      expect(reason.length, `у ${script} причина не названа`).toBeGreaterThan(20)
    }
  })

  test('каждая команда списка объявлена в package.json', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>
    }
    for (const command of DATABASE_COMMANDS) {
      expect(packageJson.scripts[command.name], `команда ${command.name} не объявлена`).toContain(
        command.script,
      )
    }
  })
})
