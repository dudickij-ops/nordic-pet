import type { Break } from './types.ts'

/**
 * Список сломов куска S8 — пять дыр, которые могут выстрелить у проверяющего.
 *
 * Тридцать четыре строки: тринадцать на замок от подбора пароля, три на выход, пять на свой
 * вид у отказа отчёта, две на отметку свежести, пять на замок от двух одновременных
 * обновлений, две на то, что человек вправду видит на экране, и одна на то, что новая схема
 * не выставлена наружу через API. Ссылаемся по имени, а не по номеру: вставка
 * нового слома сдвигает номера, и текст, написанный номерами, начинает врать молча.
 *
 * **Чего в этом списке нет и почему.** У проверки «отказавший разбор отметку не сдвигает» своего
 * слома нет. Её механизм — транзакция базы, а не наша строка: отметка пишется внутри той же
 * транзакции, что и факты, и откат уносит обе. Сломать это текстовой заменой нельзя — сломать
 * можно только записью на другом соединении, а это не правка строки, а другое устройство.
 * Ближайшая ломаемая строка — сама запись отметки — закрыта сломом `freshness-not-marked`.
 * Названо здесь, чтобы читающий видел границу доказанного, а не считал её доказанной.
 *
 * Слома «взять ждущий замок вместо пробующего» здесь больше нет: замок перестал быть
 * совещательным. Проверка кода показала, что сеансовый совещательный замок в бою не работает
 * вовсе — боевой адрес идёт через объединитель соединений в транзакционном режиме, — и замок
 * переделан на строку в таблице. Ломается он теперь двумя строками: `lock-taken-unconditionally`
 * снимает условие занятости, `lease-never-expires` делает аренду вечной.
 */

export const BREAKS: Break[] = [
  // ——— Задача 2: замок на подбор пароля ———
  {
    id: 'lockout-off',
    claim: 'не запирать вход после десяти неудач',
    mustRedden: 'после десяти неудач годный пароль не пускает',
    file: 'lib/auth/attempts.ts',
    find: '    if (замок.заперто) return { ok: false, text: текстЗапертого(замок.черезМинут) }\n',
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
      {
        name: 'незаписанная неудача — отказ про базу, а не обычное «пароль не тот»',
        why: 'без самой записи отказывать нечему: она ждёт отказа именно от неудавшейся записи',
      },
    ],
    file: 'lib/auth/attempts.ts',
    find: '      await счёт.записатьНеудачу(deps.адрес)\n',
    replace: '',
    tests: '__tests__/auth/attempts.test.ts',
  },
  {
    id: 'no-reset-on-success',
    claim: 'не обнулять счёт при удачном входе',
    mustRedden: 'удачный вход обнуляет счёт: девять неудач, вход, снова девять — пускает',
    file: 'lib/auth/attempts.ts',
    find: '        await счёт.обнулить(deps.адрес)',
    replace: '        await Promise.resolve()',
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
    find: '      состояние = await счёт.неудачи(deps.адрес)',
    replace: '      состояние = await счёт.неудачи(ОБЩЕЕ_ВЕДРО)',
    andThen: {
      find: '      await счёт.записатьНеудачу(deps.адрес)',
      replace: '      await счёт.записатьНеудачу(ОБЩЕЕ_ВЕДРО)',
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
      '  if (осталось === 0) return { заперто: false, черезМинут: 0 }\n' +
      '  return { заперто: true, черезМинут: осталось }',
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
    alsoRedden: [
      {
        name: 'ненастроенный вход не открывает соединения вовсе',
        why: 'записать попытку нельзя, не открыв счёт: одна правка отрицает оба обещания разом',
      },
    ],
    file: 'lib/auth/attempts.ts',
    find: '  if (непроставленныеПеременныеВхода(deps.env).length > 0) return войти(логин, пароль, общее)',
    // Слом обязан **сам открыть счёт**: поля `счёт` в зависимостях больше нет, и вызов через
    // него падал бы с ошибкой типа. Красное на падении доказывает падение, а не механизм.
    // Найдено проверкой кода.
    replace:
      '  if (непроставленныеПеременныеВхода(deps.env).length > 0) {\n' +
      '    const счёт = await deps.открытьСчёт()\n' +
      '    await счёт.записатьНеудачу(deps.адрес)\n' +
      '    await счёт.закрыть()\n' +
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
    alsoRedden: [
      {
        name: 'разбор возвращает числа из отставших в свежие',
        why: 'она проходит тот же путь в обе стороны, и половина «отстали» держится на том же сравнении',
      },
    ],
    file: 'lib/metrics/report.ts',
    find: '    const stale = staleRows[0]?.stale === true',
    replace: '    const stale = false',
    tests: '__tests__/facts/freshness.test.ts',
  },
  {
    id: 'freshness-not-marked',
    claim: 'не отмечать при разборе, по какому сырью собраны факты',
    mustRedden: 'разбор возвращает числа из отставших в свежие',
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
    id: 'lock-taken-unconditionally',
    claim: 'выдавать замок всякому, кто попросит',
    mustRedden: 'настоящий замок второму не даётся и после отпускания даётся снова',
    file: 'supabase/migrations/20260905090000_meta.sql',
    find:
      '   where taken_at is null or taken_at < clock_timestamp() - p_lease\n' +
      '  returning token::text into жетон;',
    replace: '  returning token::text into жетон;',
    tests: '__tests__/metrics/refresh-lock.test.ts',
    resetDb: true,
  },
  {
    /**
     * Аренда — плата за то, что таблица сама не отпустится. Без неё обновление, убитое на
     * середине, заперло бы кнопку навсегда: ровно тот дефект, ради которого замок и делался,
     * только вывернутый.
     */
    id: 'lease-never-expires',
    claim: 'сделать аренду вечной — брошенный замок не освобождается',
    mustRedden: 'протухшая аренда освобождает замок',
    alsoRedden: [
      {
        name: 'после отпускания строка замка свободна',
        why: 'брошенный замок при вечной аренде не отдаётся никому и остаётся занятым для соседки',
      },
      {
        name: 'чужое отпускание замок не отдаёт',
        why: 'она сама отбирает замок по истечении аренды, а вечная аренда отобрать не даёт',
      },
    ],
    file: 'lib/metrics/refresh.ts',
    find: "export const АРЕНДА_ЗАМКА = '10 minutes'",
    replace: "export const АРЕНДА_ЗАМКА = '100 years'",
    tests: '__tests__/metrics/refresh-lock.test.ts',
  },
  {
    id: 'busy-not-shown',
    claim: 'не показывать человеку «обновление уже идёт»',
    mustRedden: '«обновление уже идёт» человек видит на экране, а не только в возвращённом значении',
    file: 'app/refresh-panel.tsx',
    find: "      {outcome.ok === false && 'занято' in outcome && <p role=\"alert\">{outcome.text}</p>}\n",
    replace: '',
    tests: '__tests__/metrics/screen-busy.test.tsx',
  },
  {
    id: 'stale-mark-not-shown',
    claim: 'убрать со страницы пометку «числа отстали»',
    mustRedden: 'сырьё новее фактов — на экране пометка, и она говорит, что нажать',
    file: 'app/page.tsx',
    find: '      {report.устарели === true && (',
    replace: '      {false && (',
    tests: '__tests__/metrics/screen-stale.test.tsx',
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
  {
    id: 'counter-failure-lets-through',
    claim: 'пускать, когда счёт попыток недоступен',
    mustRedden: 'недоступный счёт — отказ, а не проход с годным паролем',
    file: 'lib/auth/attempts.ts',
    find:
      '  let счёт: СчётПопыток\n' +
      '  try {\n' +
      '    счёт = await deps.открытьСчёт()\n' +
      '  } catch {\n' +
      '    return { ok: false, text: СЧЁТ_НЕДОСТУПЕН }\n' +
      '  }',
    replace:
      '  let счёт: СчётПопыток\n' +
      '  try {\n' +
      '    счёт = await deps.открытьСчёт()\n' +
      '  } catch {\n' +
      '    return войти(логин, пароль, общее)\n' +
      '  }',
    tests: '__tests__/auth/attempts.test.ts',
  },
  {
    id: 'counter-not-closed',
    claim: 'не закрывать соединение счёта',
    mustRedden: 'счёт закрывается и после удачи, и после неудачи',
    alsoRedden: [
      {
        name: 'сбой выдачи cookie летит наружу, а не превращается в «база не ответила»',
        why: 'она смотрит, что последним вызовом счёта было закрытие, — а его больше нет',
      },
    ],
    file: 'lib/auth/attempts.ts',
    find: '  } finally {\n    await счёт.закрыть().catch(() => {})\n  }',
    replace: '  } finally {\n    await Promise.resolve()\n  }',
    tests: '__tests__/auth/attempts.test.ts',
  },
  {
    id: 'address-list-first-taken',
    claim: 'брать из списка адресов первый, как раньше',
    mustRedden: 'список адресов уходит в общее ведро целиком, а не разбирается по первому',
    file: 'lib/auth/attempts.ts',
    find: "  if (строка === '' || строка.includes(',')) return ОБЩЕЕ_ВЕДРО\n  return строка",
    replace: "  if (строка === '') return ОБЩЕЕ_ВЕДРО\n  return строка.split(',')[0].trim()",
    tests: '__tests__/auth/attempts.test.ts',
  },
  {
    id: 'screen-text-diverges',
    claim: 'развести текст отказа на экране с текстом слоя метрик',
    mustRedden: 'текст отказа на экране и в слое метрик — один и тот же',
    file: 'app/page.tsx',
    find:
      "  'Данные сейчас не читаются: база не ответила. Числа не показаны нарочно — показывать ' +",
    replace: "  'Данные сейчас не читаются. ' +",
    tests: '__tests__/metrics/screen-busy.test.tsx',
  },
  {
    id: 'cause-not-logged',
    claim: 'не писать подлинную причину отказа в журнал сервера',
    mustRedden: 'подлинная причина отказа уходит в журнал сервера',
    file: 'app/page.tsx',
    find: "      if (вид === 'данные не читаются') console.error('отказ отчёта:', error)\n",
    replace: '',
    tests: '__tests__/metrics/screen-refusal.test.tsx',
  },
  {
    id: 'release-without-token',
    claim: 'отпускать замок не глядя, чей он',
    mustRedden: 'чужое отпускание замок не отдаёт',
    file: 'supabase/migrations/20260905090000_meta.sql',
    find:
      '  update meta.refresh_lock\n' +
      '     set taken_at = null, token = null\n' +
      '   where token::text = p_жетон;',
    replace: '  update meta.refresh_lock set taken_at = null, token = null;',
    tests: '__tests__/metrics/refresh-lock.test.ts',
    resetDb: true,
  },
  {
    /**
     * Прежний слом этой строки краснил **падением**: он снимал перехват учёта, и наружу летел
     * необработанный отказ подставки. Красное на падении доказывает падение, а не механизм.
     * Теперь слом делает ровно то, что говорит строка: возвращает сверку внутрь перехвата.
     * Найдено проверкой кода.
     */
    id: 'login-back-inside-catch',
    claim: 'накрыть перехватом и сверку — вместе с выдачей cookie',
    mustRedden: 'сбой выдачи cookie летит наружу, а не превращается в «база не ответила»',
    file: 'lib/auth/attempts.ts',
    find: '    const исход = войти(логин, пароль, общее)',
    replace:
      '    let исход: ИсходВхода\n' +
      '    try {\n' +
      '      исход = войти(логин, пароль, общее)\n' +
      '    } catch {\n' +
      "      return { ok: false, text: СЧЁТ_НЕДОСТУПЕН }\n" +
      '    }',
    tests: '__tests__/auth/attempts.test.ts',
  },
  {
    id: 'release-failure-replaces-outcome',
    claim: 'дать отказу отпускания замка вылететь наружу',
    mustRedden: 'отказ отпускания не подменяет исход и не оставляет соединения',
    file: 'lib/metrics/refresh.ts',
    find:
      '      } catch (отказ) {\n' +
      "        console.error('замок обновления не отпустился — провисит до конца аренды:', отказ)\n" +
      '      } finally {',
    replace: '      } finally {',
    tests: '__tests__/metrics/refresh-lock.test.ts',
  },
  {
    id: 'lock-connection-not-closed',
    claim: 'не закрывать соединение замка',
    mustRedden: 'отказ отпускания не подменяет исход и не оставляет соединения',
    file: 'lib/metrics/refresh.ts',
    find: '        await клиент.release().catch(() => {})',
    replace: '        await Promise.resolve()',
    tests: '__tests__/metrics/refresh-lock.test.ts',
  },
  {
    id: 'token-is-rendered-time',
    claim: 'вернуть отметку времени вместо случайного жетона',
    mustRedden: 'замок отпускается из сеанса с другими часовым поясом и форматом дат',
    file: 'supabase/migrations/20260905090000_meta.sql',
    find: '  returning token::text into жетон;',
    replace: '  returning taken_at::text into жетон;',
    andThen: {
      find: '   where token::text = p_жетон;',
      replace: '   where taken_at::text = p_жетон;',
    },
    tests: '__tests__/metrics/refresh-lock.test.ts',
    resetDb: true,
  },
  {
    id: 'unrecorded-failure-lets-through',
    claim: 'проглотить отказ записи неудачи — замок молча выключается',
    mustRedden: 'незаписанная неудача — отказ про базу, а не обычное «пароль не тот»',
    file: 'lib/auth/attempts.ts',
    find:
      "      console.error('неудачная попытка не записана — замок от подбора не считает:', отказ)\n" +
      '      return { ok: false, text: СЧЁТ_НЕДОСТУПЕН }',
    replace:
      "      console.error('неудачная попытка не записана — замок от подбора не считает:', отказ)",
    tests: '__tests__/auth/attempts.test.ts',
  },
]
