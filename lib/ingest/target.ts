import { projectDatabaseUrl } from '@/lib/db-url'

/**
 * Куда загрузчик пишет прямо сейчас. Среда называется словом и только словом:
 * ни из наличия ключей, ни из признаков хостинга она не выводится. Косвенный признак
 * однажды совпадёт не с тем, и запись уйдёт не в ту базу, ничем себя не выдав.
 */
export type IngestTarget = {
  where: 'local' | 'production'
  /** Проверенный адрес базы. Для боя — вместе с паролем: печатать его нельзя. */
  url: string
  /** Строка «куда пишем» для вывода команды. Пароля в ней нет никогда. */
  label: string
}

/** Имя переменной, в которой среда названа. */
const TARGET = 'NORDIC_PET_DB_TARGET'

/** Имя переменной с адресом боевой базы. Живёт в переменных Vercel, не в git. */
const PRODUCTION_URL = 'SUPABASE_DB_URL'

/**
 * Локальный хост во всех написаниях, в которых его отдаёт разбор адреса.
 *
 * Список свой, а не взятый из `lib/db-url.ts`. Тот файл — замок на разрушающую команду
 * пересоздания базы, и он не меняется ни на строку, включая список того, что отдаёт наружу.
 * Три продублированных адреса дешевле, чем повод открыть тот файл.
 */
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

/** Окружение процесса: имя переменной — значение. */
type Environment = Record<string, string | undefined>

/**
 * Разбирает адрес боевой базы и отдаёт его неизменным, если он годен.
 *
 * Проверка зеркальна той, что стоит в `lib/db-url.ts`, но смотрит с другой стороны:
 * там разрешён ровно один локальный адрес, здесь запрещён любой локальный.
 *
 * **Адрес не пересобирается, а требует, чтобы каждая часть была названа.** Пересборка,
 * как в локальной проверке, потребовала бы перекодировать пароль, а перекодирование —
 * ещё одно место, где написанное и понятое драйвером расходятся. Требование назвать всё
 * закрывает то же самое: драйвер `pg` читает те же переменные `PG*`, что и libpq, и
 * дочитывает ими недостающие части адреса. Это проверено опытом на живой базе — адрес
 * без имени базы увёл соединение в базу из `PGDATABASE`. Названный целиком адрес
 * подставлять нечем.
 *
 * Ни одно сообщение об отказе не содержит адреса: в нём пароль, а ошибки уходят в журнал.
 */
export function assertProductionDatabase(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(
      `${PRODUCTION_URL} не разбирается как адрес базы. Сам адрес здесь не показан: в нём пароль`,
    )
  }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error(
      `${PRODUCTION_URL} должен быть postgresql://…, а начинается с ${parsed.protocol}//…`,
    )
  }

  const host = parsed.hostname
  if (host === '') {
    throw new Error(
      `в ${PRODUCTION_URL} не назван хост: драйвер взял бы его из переменной PGHOST, ` +
        'и проверенным оказался бы один сервер, а соединение ушло бы на другой',
    )
  }
  if (LOCAL_HOSTS.has(host)) {
    throw new Error(
      `${PRODUCTION_URL} указывает на локальный хост ${host}. Боевая база на локальном хосте ` +
        `не живёт: либо среда названа неверно, либо в переменной чужой адрес`,
    )
  }

  if (parsed.port === '') {
    throw new Error(
      `в ${PRODUCTION_URL} не назван порт: драйвер взял бы его из переменной PGPORT, ` +
        'а другой порт на том же хосте — другой сервер',
    )
  }

  const name = parsed.pathname.replace(/^\//, '')
  if (name === '') {
    throw new Error(
      `в ${PRODUCTION_URL} не названа база: драйвер взял бы имя из переменной PGDATABASE, ` +
        'и запись ушла бы в базу, которую никто не проверял',
    )
  }

  if (parsed.username === '') {
    throw new Error(
      `в ${PRODUCTION_URL} не назван пользователь: драйвер взял бы его из переменной PGUSER`,
    )
  }

  if (parsed.password === '') {
    throw new Error(
      `в ${PRODUCTION_URL} не назван пароль: драйвер взял бы его из переменной PGPASSWORD ` +
        'или из файла .pgpass, и соединение зависело бы от того, что лежит на машине',
    )
  }

  // Адрес идёт по публичной сети. Отключённое шифрование означает пароль и данные
  // открытым текстом — это запрещено контрактом S1 и не обсуждается «на минутку».
  if (parsed.searchParams.get('sslmode') === 'disable') {
    throw new Error(
      `в ${PRODUCTION_URL} стоит sslmode=disable: боевой адрес идёт по публичной сети, ` +
        'и без шифрования пароль и данные уходят открытым текстом',
    )
  }

  return url
}

/** Хост и имя базы из адреса — то, что можно назвать вслух. Пароль сюда не попадает. */
function announceable(url: string): { host: string; database: string } {
  const parsed = new URL(url)
  return { host: parsed.hostname, database: parsed.pathname.replace(/^\//, '') }
}

/**
 * Отвечает на вопрос «куда пишем» — и отказывается отвечать, если среда не названа.
 *
 * Загрузчику нужен то локальная база, то боевая, а замок `lib/db-url.ts` разрешает
 * единственную локальную: он писался для команды, которая базу сносит. Поэтому здесь
 * свой путь, а тот замок остаётся ровно таким, каким был.
 */
export function resolveIngestTarget(env: Environment = process.env): IngestTarget {
  const where = env[TARGET]

  if (where === 'local') {
    // Тот же адрес и та же жёсткая проверка, что у проверок и у пересоздания базы.
    const url = projectDatabaseUrl()
    const { host, database } = announceable(url)
    return { where, url, label: `цель: local, база ${database} на ${host}` }
  }

  if (where === 'production') {
    const url = env[PRODUCTION_URL]
    if (url === undefined || url === '') {
      throw new Error(
        `среда названа production, но ${PRODUCTION_URL} пуста. Адрес боевой базы живёт ` +
          'в переменных Vercel и никогда в git',
      )
    }
    const checked = assertProductionDatabase(url)
    const { host, database } = announceable(checked)
    return { where, url: checked, label: `цель: production, база ${database} на ${host}` }
  }

  throw new Error(
    `${TARGET} обязана быть названа словом: local или production. ` +
      (where === undefined
        ? 'Сейчас она не задана вовсе'
        : `Сейчас в ней «${where}», а угадывать среду по косвенным признакам нельзя: ` +
          'ошибка вскроется записью не в ту базу'),
  )
}
