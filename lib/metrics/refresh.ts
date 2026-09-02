import { DATABASE_COMMANDS, type DatabaseCommand } from '../commands.ts'

/**
 * Кнопка «Обновить данные» — задача 8.
 *
 * Три шага в жёстком порядке: загрузка Таблицы → загрузка папки → разбор. Каждый шаг —
 * своя транзакция, доставшаяся от S2, S3 и S4, и отсюда щель, названная в контракте S4
 * заранее: если загрузки прошли, а разбор отказался, сырьё новое, а факты вчерашние, и
 * по фактам этого не видно. `stale: true` у отказа разбора — это и есть отметка щели: её
 * обязана показать панель, а не только текст.
 *
 * Своей дороги в базу у кнопки нет: она не импортирует ни `ingestSheets`, ни
 * `ingestAdsFolder`, ни `buildFacts` напрямую, а ищет в списке команд (`DATABASE_COMMANDS`
 * по умолчанию, подставка — через `deps.commands`) записи `ingest:sheets`, `ingest:ads`,
 * `facts` по имени и зовёт их боевое поле `real`. Имени, которого в списке нет, — отказ,
 * и это не операционный отказ вида `RefreshOutcome`, а падение до всякой работы: это
 * ошибка устройства, а не то, что случается на бою.
 */

export type RefreshOutcome =
  | { ok: true }
  | { ok: false; step: 'Таблица' | 'папка' | 'разбор'; text: string; stale: boolean }

export type RefreshDeps = {
  /** Куда дошли — говорится до всякой работы, а не после. */
  announce: (line: string) => void
  /** Список команд, из которого шаги берутся по имени. По умолчанию — боевой список. */
  commands: DatabaseCommand[]
  ingestSheets: () => Promise<unknown>
  ingestAds: () => Promise<unknown>
  buildFacts: () => Promise<unknown>
}

type StepName = 'ingest:sheets' | 'ingest:ads' | 'facts'

/** Как шаг называется человеку — те самые три слова из контракта. */
const STEP_LABEL: Record<StepName, 'Таблица' | 'папка' | 'разбор'> = {
  'ingest:sheets': 'Таблица',
  'ingest:ads': 'папка',
  facts: 'разбор',
}

/**
 * Ищет боевой вызов работы по имени в списке команд.
 *
 * Разрешается до всякой работы, а не в момент вызова шага: имени, которого в списке нет, —
 * это ошибка устройства кнопки, и обнаружить её до того, как что-то успело перечитаться
 * наполовину, лучше, чем после.
 */
function stepFromCommands(commands: DatabaseCommand[], name: StepName): () => Promise<unknown> {
  const command = commands.find((entry) => entry.name === name)
  if (command === undefined) {
    throw new Error(`команды ${name} нет в списке — обход списка невозможен по построению`)
  }
  return command.real
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Отказ — читаемым текстом: какой шаг, что случилось, и что сделать. */
function refusal(step: StepName, error: unknown, stale: boolean): RefreshOutcome {
  const reason = messageOf(error)
  const what =
    step === 'ingest:sheets'
      ? `загрузка Google Таблицы не удалась: ${reason}. Папка и разбор не запускались, ` +
        'числа ниже не менялись.'
      : step === 'ingest:ads'
        ? `загрузка папки ads-exports не удалась: ${reason}. Разбор не запускался, числа ` +
          'ниже не менялись.'
        : `источники перечитаны, но разбор не удался: ${reason}. Числа ниже — от прежнего ` +
          'удачного разбора и устарели.'
  return {
    ok: false,
    step: STEP_LABEL[step],
    text: `${what} Нажмите «Обновить данные» ещё раз.`,
    stale,
  }
}

/**
 * Зовёт три шага по порядку. Отказ первого или второго шага не создаёт щели — сырьё и
 * факты остаются согласованными, — но показывается тем же способом и с тем же текстом
 * про шаг. Отказ разбора после удачных загрузок — щель: `stale: true`.
 */
export async function refreshEverything(deps: Partial<RefreshDeps> = {}): Promise<RefreshOutcome> {
  const announce = deps.announce ?? (() => {})
  const commands = deps.commands ?? DATABASE_COMMANDS

  const ingestSheets = deps.ingestSheets ?? stepFromCommands(commands, 'ingest:sheets')
  const ingestAds = deps.ingestAds ?? stepFromCommands(commands, 'ingest:ads')
  const buildFacts = deps.buildFacts ?? stepFromCommands(commands, 'facts')

  announce('Таблица')
  try {
    await ingestSheets()
  } catch (error) {
    return refusal('ingest:sheets', error, false)
  }

  announce('папка')
  try {
    await ingestAds()
  } catch (error) {
    return refusal('ingest:ads', error, false)
  }

  announce('разбор')
  try {
    await buildFacts()
  } catch (error) {
    return refusal('facts', error, true)
  }

  return { ok: true }
}
