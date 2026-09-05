import type { Break } from './types.ts'

/**
 * Список сломов куска S8 — пять дыр, которые могут выстрелить у проверяющего.
 *
 * Двадцать строк: восемь на замок от подбора пароля, три на выход, три на свой вид у отказа
 * отчёта, две на отметку свежести, три на замок от двух одновременных обновлений и одна на то,
 * что новая схема не выставлена наружу через API. Ссылаемся по имени, а не по номеру: вставка
 * нового слома сдвигает номера, и текст, написанный номерами, начинает врать молча.
 *
 * **Чего в этом списке нет и почему.** У проверки «отказавший разбор отметку не сдвигает» своего
 * слома нет. Её механизм — транзакция базы, а не наша строка: отметка пишется внутри той же
 * транзакции, что и факты, и откат уносит обе. Сломать это текстовой заменой нельзя — сломать
 * можно только записью на другом соединении, а это не правка строки, а другое устройство.
 * Ближайшая ломаемая строка — сама запись отметки — закрыта сломом `freshness-not-marked`.
 * Названо здесь, чтобы читающий видел границу доказанного, а не считал её доказанной.
 *
 * `waiting-lock` краснит свою проверку **по истечении времени ожидания**, а не утверждением:
 * ждущий замок именно что ждёт, и проверка, которой обещано «второй уходит ни с чем», честно не
 * дожидается ответа. Это и есть её утверждение, просто выраженное временем.
 */

export const BREAKS: Break[] = [
  // ——— Задача 2: замок на подбор пароля ———
  {
    id: 'lockout-off',
    claim: 'не запирать вход после десяти неудач',
    mustRedden: 'после десяти неудач годный пароль не пускает',
    file: 'lib/auth/attempts.ts',
    find: '  if (замок.заперто) return { ok: false, text: текстЗапертого(замок.черезМинут) }\n',
    replace: '',
    tests: '__tests__/auth/attempts.test.ts',
  },
  {
    id: 'failure-not-recorded',
    claim: 'не записывать неудачную попытку',
    mustRedden: 'неудачная попытка идёт в счёт',
    alsoRedden: [
      {
        name: 'после десяти неудач годный пароль не пускает',
        why: 'незаписанные неудачи не копятся, и порог не достигается вовсе',
      },
    ],
    file: 'lib/auth/attempts.ts',
    find: '  else await deps.счёт.записатьНеудачу(deps.адрес)',
    replace: '',
    tests: '__tests__/auth/attempts.test.ts',
  },
  {
    id: 'no-reset-on-success',
    claim: 'не обнулять счёт при удачном входе',
    mustRedden: 'удачный вход обнуляет счёт: девять неудач, вход, снова девять — пускает',
    file: 'lib/auth/attempts.ts',
    find: '  if (исход.ok) await deps.счёт.обнулить(deps.адрес)',
    replace: '  if (исход.ok) await Promise.resolve()',
    tests: '__tests__/auth/attempts.test.ts',
  },
  {
    id: 'one-bucket-for-all',
    claim: 'считать все адреса одним общим ведром',
    mustRedden: 'запирание с одного адреса не запирает другой',
    alsoRedden: [
      {
        name: 'неудачная попытка идёт в счёт',
        why: 'она смотрит записи своего адреса, а общее ведро уводит их в чужой ящик',
      },
      {
        name: 'удачный вход обнуляет счёт: девять неудач, вход, снова девять — пускает',
        why: 'та же причина: неудачи копятся не там, где их потом ищут',
      },
    ],
    file: 'lib/auth/attempts.ts',
    find: '  const { неудач, самаяРанняя } = await deps.счёт.неудачи(deps.адрес)',
    replace: '  const { неудач, самаяРанняя } = await deps.счёт.неудачи(ОБЩЕЕ_ВЕДРО)',
    andThen: {
      find: '  else await deps.счёт.записатьНеудачу(deps.адрес)',
      replace: '  else await deps.счёт.записатьНеудачу(ОБЩЕЕ_ВЕДРО)',
    },
    tests: '__tests__/auth/attempts.test.ts',
  },
  {
    /**
     * Отпускает запирание **окно счёта**, а не отдельный срок: неудачи старше окна не
     * считаются вовсе, и порог перестаёт достигаться сам собой. Поэтому слом растягивает окно,
     * а не трогает решение о запирании: прежняя правка краснила счёт оставшихся минут, то есть
     * доказывала не то, что написано в строке. Найдено прибором.
     */
    id: 'window-never-expires',
    claim: 'растянуть окно счёта так, чтобы старые неудачи не уходили',
    mustRedden: 'по истечении окна вход снова работает',
    file: 'lib/auth/attempts.ts',
    find: 'export const ОКНО_МИНУТ = 15',
    replace: 'export const ОКНО_МИНУТ = 100_000',
    tests: '__tests__/auth/attempts.test.ts',
  },
  {
    id: 'minutes-left-not-counted',
    claim: 'не считать, сколько осталось ждать',
    mustRedden: 'на пороге заперто и названо, сколько ждать',
    file: 'lib/auth/attempts.ts',
    find:
      '  const осталось = Math.max(0, Math.ceil((отпустит - сейчас) / 60_000))\n' +
      '  return осталось === 0 ? { заперто: false, черезМинут: 0 } : { заперто: true, черезМинут: осталось }',
    replace: '  return { заперто: true, черезМинут: ОКНО_МИНУТ }',
    tests: '__tests__/auth/attempts.test.ts',
  },
  {
    id: 'expired-not-deleted',
    claim: 'не удалять записи старше окна',
    mustRedden: 'запись неудачи прибирает записи старше окна',
    file: 'supabase/migrations/20260905090000_meta.sql',
    find: '  delete from meta.login_attempts where failed_at < clock_timestamp() - p_window;\n',
    replace: '',
    tests: '__tests__/db/meta.test.ts',
    resetDb: true,
  },
  {
    id: 'unconfigured-counts-as-attempt',
    claim: 'считать отказ ненастроенного входа за попытку',
    mustRedden: 'ненастроенный вход счёт не двигает и до счёта вообще не доходит',
    file: 'lib/auth/attempts.ts',
    find: '  if (непроставленныеПеременныеВхода(deps.env).length > 0) return войти(логин, пароль, общее)',
    replace:
      '  if (непроставленныеПеременныеВхода(deps.env).length > 0) {\n' +
      '    await deps.счёт.записатьНеудачу(deps.адрес)\n' +
      '    return войти(логин, пароль, общее)\n' +
      '  }',
    tests: '__tests__/auth/attempts.test.ts',
  },

  // ——— Задача 3: выход ———
  {
    id: 'logout-keeps-cookie',
    claim: 'не удалять cookie при выходе',
    mustRedden: 'выход удаляет именно cookie входа',
    file: 'app/logout-action.ts',
    find: '  хранилище.delete(SESSION_COOKIE)\n',
    replace: '',
    tests: '__tests__/auth/logout.test.tsx',
  },
  {
    id: 'logout-no-redirect',
    claim: 'не уводить на вход после выхода',
    mustRedden: 'выход уводит человека на страницу входа',
    alsoRedden: [
      {
        name: 'выход удаляет именно cookie входа',
        why: 'она ждёт брошенного перехода: без него вызов возвращается тихо, и ждать нечего',
      },
    ],
    file: 'app/logout-action.ts',
    find: "  redirect('/login')\n",
    replace: '',
    tests: '__tests__/auth/logout.test.tsx',
  },
  {
    id: 'logout-button-off',
    claim: 'убрать кнопку выхода со страницы отчёта',
    mustRedden: 'на странице отчёта есть кнопка выхода',
    file: 'app/page.tsx',
    find: '    <>\n      <LogoutButton />',
    replace: '    <>',
    tests: '__tests__/auth/logout.test.tsx',
  },

  // ——— Задача 4: свой вид у отказа отчёта ———
  {
    id: 'data-refusal-untyped',
    claim: 'не называть вид у отказа, случившегося при чтении данных',
    mustRedden: 'сбой базы — отказ своего вида, и адреса базы в нём нет',
    alsoRedden: [
      {
        name: 'неназванная среда — тот же вид отказа, а не падение наружу',
        why: 'тот же снятый перевод: наружу летит чужая ошибка, не назвавшая вида',
      },
    ],
    file: 'lib/metrics/report.ts',
    find:
      "      throw new ОтказОтчёта(\n" +
      "        'данные не читаются',\n" +
      '        причина instanceof Error ? причина.message : String(причина),\n' +
      '        причина,\n' +
      '      )',
    replace: '      throw причина',
    tests: '__tests__/metrics/report-refusal.test.ts',
  },
  {
    id: 'screen-prints-refusal-message',
    claim: 'печатать на экране сообщение отказа как есть',
    mustRedden: 'в разметке страницы отказа нет ни адреса базы, ни имени пользователя базы',
    file: 'app/page.tsx',
    find:
      "      const текст =\n" +
      "        вид === 'данные не читаются' ? ТЕКСТ_ДАННЫЕ_НЕ_ЧИТАЮТСЯ : (error as Error).message",
    replace: '      const текст = (error as Error).message',
    tests: '__tests__/metrics/screen-refusal.test.tsx',
  },
  {
    id: 'month-refusal-untyped',
    claim: 'не называть вид у отказа на кривом месяце',
    mustRedden: 'кривой месяц — отказ своего вида, и текст прежний',
    file: 'lib/metrics/report.ts',
    find:
      '    throw new ОтказОтчёта(\n' +
      "      'кривой месяц',\n" +
      '      `месяц обязан быть в форме ГГГГ-ММ (пример: «2026-03»), а пришло «${month}»`,\n' +
      '    )',
    replace:
      '    throw new Error(\n' +
      '      `месяц обязан быть в форме ГГГГ-ММ (пример: «2026-03»), а пришло «${month}»`,\n' +
      '    )',
    tests: '__tests__/metrics/report-refusal.test.ts',
  },

  // ——— Задача 5: отметка свежести ———
  {
    id: 'freshness-not-compared',
    claim: 'не сравнивать отметку с самым поздним изменением сырья',
    mustRedden: 'сырьё новее фактов — отчёт говорит, что числа отстали',
    file: 'lib/metrics/report.ts',
    find: '    const stale = staleRows[0]?.stale === true',
    replace: '    const stale = false',
    tests: '__tests__/facts/freshness.test.ts',
  },
  {
    id: 'freshness-not-marked',
    claim: 'не отмечать при разборе, по какому сырью собраны факты',
    mustRedden: 'после разбора числа не помечены устаревшими',
    alsoRedden: [
      {
        name: 'отказавший разбор отметку не сдвигает',
        why: 'она сравнивает отметку до и после, а без записи отметки сравнивать нечего',
      },
    ],
    file: 'lib/facts/build.ts',
    find: "    await client.query('select meta.mark_fact_freshness()')\n",
    replace: '',
    tests: '__tests__/facts/freshness.test.ts',
    resetDb: true,
  },

  // ——— Задача 6: замок на два одновременных обновления ———
  {
    id: 'refresh-lock-not-taken',
    claim: 'не брать замок перед работой',
    mustRedden: 'второй прогон внахлёст не позвал ни одной из трёх работ',
    file: 'lib/metrics/refresh.ts',
    find: '  if (!замок.взят) {',
    replace: '  if (false) {',
    tests: '__tests__/metrics/refresh-lock.test.ts',
  },
  {
    id: 'refresh-lock-not-released',
    claim: 'не отпускать замок после работы',
    mustRedden: 'замок отпускается и после отказа шага',
    file: 'lib/metrics/refresh.ts',
    find:
      '  } finally {\n' +
      '    // Отпускается в любом исходе: иначе один отказ запер бы кнопку до перезапуска процесса.\n' +
      '    await замок.отпустить()\n' +
      '  }',
    replace: '  } finally {\n    await Promise.resolve()\n  }',
    tests: '__tests__/metrics/refresh-lock.test.ts',
  },
  {
    id: 'waiting-lock',
    claim: 'взять ждущий замок вместо пробующего',
    mustRedden: 'настоящий замок второму не даётся и после отпускания даётся снова',
    alsoRedden: [
      {
        name: 'замок не остаётся висеть в базе после отпускания',
        why: 'ждущий замок не возвращает управления, и соседка не доходит до своего вопроса базе',
      },
    ],
    file: 'lib/metrics/refresh.ts',
    find: "'select pg_try_advisory_lock($1) as взят'",
    replace: "'select pg_advisory_lock($1) is not null as взят'",
    tests: '__tests__/metrics/refresh-lock.test.ts',
  },

  // ——— Задача 1: новая схема наружу не выставлена ———
  {
    id: 'meta-exposed-through-api',
    claim: 'выставить схему meta наружу через API',
    mustRedden: 'схема meta наружу через API не выставлена',
    file: 'supabase/config.toml',
    find: 'schemas = ["public", "graphql_public"]',
    replace: 'schemas = ["public", "graphql_public", "meta"]',
    tests: '__tests__/db/meta.test.ts',
  },
]
