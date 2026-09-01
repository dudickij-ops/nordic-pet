import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

import { describe, expect, test } from 'vitest'

import {
  ALWAYS_ALLOWED,
  DATABASE_COMMANDS,
  NOT_A_COMMAND,
  OUTSIDE_WORLDS,
  type DatabaseCommand,
  type ProbeClient,
  type Probes,
} from '@/lib/commands'

/**
 * Обязательства всякой команды, ходящей в базу.
 *
 * Список обязательств один на проект, и новая команда проходит его самим фактом того, что
 * она записана в `lib/commands.ts`. Прежде эти же требования жили прозой в правилах, и
 * дважды подряд — в S3 и в S4 — их находил рецензент, а не проверка: снятие переменных
 * `PG*`, называние цели до работы, запуск простым `node`. Проза не проверяется.
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

/** Голые имена модулей, достижимые из файла по цепочке относительных импортов. */
function bareImportsReachableFrom(entry: string): Set<string> {
  const seen = new Set<string>()
  const bare = new Set<string>()
  const queue = [resolve(entry)]

  while (queue.length > 0) {
    const file = queue.pop() as string
    if (seen.has(file)) continue
    seen.add(file)

    let text: string
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue
    }

    for (const match of text.matchAll(/(?:^|\n)\s*import\s[^'"]*['"]([^'"]+)['"]/g)) {
      const specifier = match[1]
      if (specifier.startsWith('.')) {
        queue.push(resolve(dirname(file), specifier))
      } else if (!specifier.startsWith('node:')) {
        bare.add(specifier)
      }
    }
  }

  return bare
}

describe.each(DATABASE_COMMANDS)('обязательства команды $name', (command) => {
  test('запускается простым node: все её части находятся', () => {
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
  })

  test('неназванная среда — отказ до всякой работы', () => {
    // Среда не названа вовсе. Угадывать её по косвенным признакам нельзя: ошибка
    // вскроется записью не в ту базу.
    const run = runScript(command, { NORDIC_PET_DB_TARGET: '' })
    expect(run.stderr).toContain('NORDIC_PET_DB_TARGET')
    expect(run.stderr).toContain(command.refusal)
    expect(run.stdout).toBe('')
    expect(run.status).toBe(1)
  })

  test('цель названа до первой работы, а не после неё', async () => {
    const savedTarget = process.env.NORDIC_PET_DB_TARGET
    process.env.NORDIC_PET_DB_TARGET = 'local'
    try {
      const timeline = await timelineOf(command)

      // Команда обязана дойти до соединения: иначе проверка ниже зеленела бы от того,
      // что работы не было вовсе.
      const connected = timeline.findIndex((event) => event.startsWith('соединение'))
      expect(connected, `команда ${command.name} не дошла до соединения: ${timeline.join(' → ')}`)
        .toBeGreaterThanOrEqual(0)

      const named = timeline.findIndex((event) => event.startsWith('цель:'))
      expect(named).toBe(0)
      expect(named).toBeLessThan(connected)
    } finally {
      if (savedTarget === undefined) delete process.env.NORDIC_PET_DB_TARGET
      else process.env.NORDIC_PET_DB_TARGET = savedTarget
    }
  })

  test('переменные PG* сняты до соединения', async () => {
    // Драйвер читает те же переменные, что и libpq: оставленный `PGHOST` — это чужой
    // адрес, подставленный с другой стороны, и запись ушла бы не в ту базу молча.
    const savedTarget = process.env.NORDIC_PET_DB_TARGET
    const savedHost = process.env.PGHOST
    process.env.NORDIC_PET_DB_TARGET = 'local'
    process.env.PGHOST = 'подставной-хост'
    try {
      const timeline = await timelineOf(command)
      const connection = timeline.find((event) => event.startsWith('соединение'))
      expect(connection, `команда ${command.name} не дошла до соединения`).toBeDefined()
      expect(connection).toBe('соединение, PGHOST=снят')
    } finally {
      if (savedTarget === undefined) delete process.env.NORDIC_PET_DB_TARGET
      else process.env.NORDIC_PET_DB_TARGET = savedTarget
      if (savedHost === undefined) delete process.env.PGHOST
      else process.env.PGHOST = savedHost
    }
  })

  test('не ходит наружу никуда, кроме объявленного', () => {
    const reachable = bareImportsReachableFrom(command.script)
    const declared = command.outsideWorld.flatMap((world) => OUTSIDE_WORLDS[world] ?? [])

    const allowed = new Set([...ALWAYS_ALLOWED, ...declared])
    const undeclared = [...reachable].filter((module) => !allowed.has(module))
    expect(undeclared, `команда ${command.name} тянет необъявленный внешний мир`).toEqual([])

    // Объявление обязано быть точным в обе стороны: мир, объявленный «на всякий случай»,
    // через год окажется единственным следом того, куда команда ходит.
    const unused = declared.filter((module) => !reachable.has(module))
    expect(unused, `команда ${command.name} объявила мир, до которого не ходит`).toEqual([])
  })
})

describe('список команд', () => {
  test('каждый сценарий либо команда, либо назван не командой с причиной', () => {
    // Без этого замка список — тот же чек-лист, который уже дважды не сработал: новая
    // команда просто не попала бы в него, и обязательства остались бы непроверенными.
    const scripts = readdirSync('scripts')
      .filter((name) => name.endsWith('.ts'))
      .map((name) => relative('.', join('scripts', name)))

    const known = new Set([
      ...DATABASE_COMMANDS.map((command) => command.script),
      ...Object.keys(NOT_A_COMMAND),
    ])

    expect(scripts.filter((script) => !known.has(script))).toEqual([])
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
