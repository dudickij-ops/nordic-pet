import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { Client } from 'pg'

import { clearPostgresEnvironment, projectDatabaseUrl } from '../lib/db-url.ts'

/**
 * Пересоздание базы.
 *
 * Обёртка вокруг `supabase db reset` нужна за тремя вещами.
 *
 * Первая: адрес проходит проверку принадлежности проекту до того, как команда что-нибудь
 * снесёт. Рядом на этом сервере живут чужие базы, и опечатки в переменной окружения хватило бы.
 *
 * Вторая: окружение чистится от всех переменных `PG*` — до того, как отсюда что-нибудь
 * запустится. Проверенный адрес защищает только тот вызов, которому он передан, а всё
 * прочее, что идёт следом, читает окружение само: `PGDATABASE`, `PGHOST`, `PGPORT`,
 * `PGUSER`, `PGSERVICEFILE` уводят клиента libpq туда же, куда увёл бы чужой адрес.
 *
 * Третья: посев применяется второй раз. Пересоздание обязано быть повторяемым — «нажал
 * „Обновить“ второй раз, ни одно число не сдвинулось», — и надёжнее всего это держать так,
 * чтобы неидемпотентный посев ломал саму команду пересоздания, а не только проверку. Указать
 * файл посева дважды в настройках не выходит: проверено прогоном, CLI схлопывает повторяющиеся
 * пути и применяет файл один раз — и в `[db.seed] sql_paths`, и в повторённом флаге
 * `--sql-paths`. Поэтому второй прогон делается здесь, явно.
 */

const SEED = join(process.cwd(), 'supabase', 'seed.sql')

// Первым делом и до всего остального: дальше отсюда не должно уйти ни одного вызова,
// которому окружение способно подсказать чужой хост, порт, базу или файл службы.
clearPostgresEnvironment()

let url: string
try {
  url = projectDatabaseUrl()
} catch (error) {
  console.error(`пересоздание базы отменено: ${(error as Error).message}`)
  process.exit(1)
}

const reset = spawnSync('supabase', ['db', 'reset', '--yes', '--db-url', url], {
  stdio: 'inherit',
})

if (reset.status !== 0) process.exit(reset.status ?? 1)

const client = new Client({ connectionString: url })
try {
  await client.connect()
  await client.query(readFileSync(SEED, 'utf8'))
  console.log('Посев применён второй раз: строк не прибавилось, ничего не изменилось.')
} catch (error) {
  console.error(
    `посев не пережил второго применения: ${(error as Error).message}\n` +
      'пересоздание базы обязано быть повторяемым — посев должен писать через ' +
      'raw.replace_*, а не собственными вставками',
  )
  process.exitCode = 1
} finally {
  await client.end()
}
