import type { Break } from './types.ts'

/**
 * Список сломов куска S6 — вход по паролю и закрытие всех путей.
 *
 * Двадцать пять строк: двадцать одна из таблицы контракта плюс четыре, которых в контракте
 * нет и которые появились от решений плана и от проверки кода. Ссылаемся на них по имени, а
 * не по номеру строки: вставка нового слома сдвигает номера, и текст, написанный номерами,
 * начинает врать молча — так уже случилось однажды с этим самым заголовком.
 *
 * `proxy-opens-report` отделяет первый слой закрытия от второго: без него «снять сторожа со
 * страницы» и «сломать общий слой» доказывались бы одной и той же проверкой.
 * `no-secret-lets-through` сторожит направление отказа при неназванном секрете: «нечем
 * проверить подпись» обязано значить «не пускаем», а не «пускаем».
 * `guard-lets-through-without-request` сторожит само правило владельца — в стороже нет
 * разрешающих веток. `matcher-widened` пришёл из проверки кода: у образца путей первого слоя
 * не было ни проверки, ни слома, и опечатка в нём выводила бы путь из-под закрытия молча,
 * не покраснев ничем.
 *
 * Прогон читает этот же список, и таблица отчёта рождается из его вывода, а не из пересказа.
 */

export const BREAKS: Break[] = [
  {
    id: 'page-guard-off',
    claim: 'снять сторожа со страницы отчёта',
    mustRedden: 'страница отчёта уводит на вход, а не рисует отчёт',
    alsoRedden: [
      {
        name: 'просроченная cookie на страницу отчёта не пускает',
        why: 'без сторожа страницу не разворачивает никакая cookie — ни отсутствующая, ни просроченная',
      },
    ],
    file: 'app/page.tsx',
    find: "  if ((await проверитьДоступ()) === 'отказать') redirect('/login')\n\n  const params = await searchParams",
    replace: '  const params = await searchParams',
    tests: '__tests__/auth/guarded-paths.test.tsx',
  },
  {
    id: 'action-guard-off',
    claim: 'снять сторожа с серверного действия кнопки',
    mustRedden: 'действие кнопки в запросе без cookie в базу не идёт',
    file: 'app/refresh-action.ts',
    find: "  if ((await проверитьДоступ()) === 'отказать') redirect('/login')\n\n  try {",
    replace: '  try {',
    tests: '__tests__/auth/guarded-paths.test.tsx',
  },
  {
    id: 'closed-list-instead-of-exceptions',
    claim: 'закрывать перечисленные пути вместо «всё, кроме исключений»',
    mustRedden: 'новый путь без записи в исключениях требует входа',
    file: 'proxy.ts',
    find: "  if ((ИСКЛЮЧЕНИЯ as readonly string[]).includes(путь)) return NextResponse.next()\n  if (путь === ВХОД) return NextResponse.next()",
    replace: "  const ЗАКРЫТЫЕ = ['/']\n  if (!ЗАКРЫТЫЕ.includes(путь)) return NextResponse.next()",
    tests: '__tests__/auth/closed.test.ts',
  },
  {
    id: 'extra-exception',
    claim: 'вписать в исключения лишнее',
    mustRedden: 'список исключений ровно из одной строки, и она та самая',
    file: 'proxy.ts',
    find: "export const ИСКЛЮЧЕНИЯ = ['/health'] as const",
    replace: "export const ИСКЛЮЧЕНИЯ = ['/health', '/лишнее'] as const",
    tests: '__tests__/auth/closed.test.ts',
  },
  {
    id: 'health-closed-too',
    claim: 'закрыть `/health` заодно со всем',
    mustRedden: '/health открыта без cookie',
    alsoRedden: [
      {
        name: 'без секрета подписи закрыто всё, кроме исключений',
        why: 'она же сторожит, что открытое остаётся открытым и без секрета: список исключений перестал спрашиваться вовсе',
      },
    ],
    file: 'proxy.ts',
    find: "  if ((ИСКЛЮЧЕНИЯ as readonly string[]).includes(путь)) return NextResponse.next()\n",
    replace: '',
    tests: '__tests__/auth/closed.test.ts',
  },
  {
    id: 'matcher-widened',
    claim: 'расширить выведенное из образца путей со сборочной выдачи до всего `_next`',
    mustRedden: 'образец путей зовёт первый слой на всё, кроме сборочной выдачи',
    file: 'proxy.ts',
    find: "  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],",
    replace: "  matcher: ['/((?!_next|favicon.ico).*)'],",
    tests: '__tests__/auth/closed.test.ts',
  },
  {
    id: 'matcher-drops-app-path',
    claim: 'вывести из образца путей заведённый путь приложения',
    mustRedden: 'образец путей зовёт первый слой на всё, кроме сборочной выдачи',
    file: 'proxy.ts',
    find: "  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],",
    replace: "  matcher: ['/((?!_next/static|_next/image|favicon.ico|health).*)'],",
    tests: '__tests__/auth/closed.test.ts',
  },
  {
    id: 'health-says-more',
    claim: 'заставить `/health` отдать что-нибудь сверх номера коммита',
    mustRedden: '/health отдаёт ровно номер коммита',
    file: 'app/health/page.tsx',
    find: '        Коммит: <code>{resolveCommit()}</code>',
    replace: '        Коммит: <code>{resolveCommit()}</code> · среда: {process.env.NODE_ENV}',
    tests: '__tests__/auth/health.test.tsx',
  },
  {
    id: 'proxy-opens-report',
    claim: 'развернуть закрытие страницы отчёта в первом слое',
    mustRedden: 'страница отчёта без cookie не отдаёт чисел',
    alsoRedden: [
      {
        name: 'действие кнопки без cookie отказывает и работы не делает',
        why: 'серверное действие — это POST на «/», и открытый в первом слое путь открыт для него тоже',
      },
      {
        name: 'чужая, просроченная и порченая cookie ко входу не пускают',
        why: 'все её заходы идут на «/»: открытый путь пускает с любой cookie',
      },
      {
        name: 'без секрета подписи закрыто всё, кроме исключений',
        why: 'её заход на «/» тоже проходит: до проверки подписи дело не доходит вовсе',
      },
      {
        name: 'каждый путь приложения либо в исключениях, либо закрыт',
        why: '«/» — путь приложения не из списка исключений, а открыт',
      },
    ],
    file: 'proxy.ts',
    find: '  if (путь === ВХОД) return NextResponse.next()',
    replace: "  if (путь === ВХОД || путь === '/') return NextResponse.next()",
    tests: '__tests__/auth/closed.test.ts',
  },
  {
    id: 'password-char-by-char',
    claim: 'сравнивать пароль посимвольно',
    mustRedden: 'сравнение пароля стойко ко времени',
    file: 'lib/auth/password.ts',
    find: '  return сравнить(свёртка(данное), свёртка(ожидаемое))',
    replace: '  return данное === ожидаемое',
    tests: '__tests__/auth/password.test.ts',
  },
  {
    id: 'refusal-prints-password',
    claim: 'печатать пароль в тексте отказа',
    mustRedden: 'отказ входа не называет ни пароля, ни секрета',
    alsoRedden: [
      {
        name: 'неверный вход отвечает одинаково на любой ввод',
        why: 'она закрепляет текст отказа до знака, поэтому любой пароль, попавший в отказ, краснит и её; сузить слом нельзя — утечка, невидимая ей, невидима и своей проверке',
      },
    ],
    file: 'lib/auth/login.ts',
    find: '  if (!логинСовпал || !парольСовпал) return { ok: false, text: ОТКАЗ }',
    replace:
      "  if (!логинСовпал || !парольСовпал)\n    return { ok: false, text: ОТКАЗ + ' (ожидался ' + deps.env[ИМЯ_ПАРОЛЯ] + ')' }",
    tests: '__tests__/auth/login.test.tsx',
  },
  {
    id: 'secret-into-log',
    claim: 'печатать секрет подписи в журнале',
    mustRedden: 'секрет подписи не попадает ни в текст отказа, ни в журнал',
    file: 'lib/auth/session.ts',
    find: 'function подпись(тело: string, секрет: string): string {',
    replace:
      "function подпись(тело: string, секрет: string): string {\n  console.log('подписываю', тело, секрет)",
    tests: '__tests__/auth/session.test.ts',
  },
  {
    id: 'different-answers',
    claim: 'различать ответы на неверный логин и неверный пароль',
    mustRedden: 'неверный вход отвечает одинаково на любой ввод',
    file: 'lib/auth/login.ts',
    find: '  if (!логинСовпал || !парольСовпал) return { ok: false, text: ОТКАЗ }',
    replace:
      "  if (!логинСовпал) return { ok: false, text: 'Такого логина нет' }\n  if (!парольСовпал) return { ok: false, text: 'Пароль не подошёл' }",
    tests: '__tests__/auth/login.test.tsx',
  },
  {
    id: 'cookie-no-httponly',
    claim: 'снять `HttpOnly`',
    mustRedden: 'cookie выдаётся с HttpOnly, Secure и SameSite',
    file: 'lib/auth/login.ts',
    find: '    httpOnly: true,',
    replace: '    httpOnly: false,',
    tests: '__tests__/auth/login.test.tsx',
  },
  {
    id: 'cookie-no-secure',
    claim: 'снять `Secure`',
    mustRedden: 'cookie выдаётся с HttpOnly, Secure и SameSite',
    file: 'lib/auth/login.ts',
    find: '    secure: true,',
    replace: '    secure: false,',
    tests: '__tests__/auth/login.test.tsx',
  },
  {
    id: 'cookie-no-samesite',
    claim: 'снять `SameSite`',
    mustRedden: 'cookie выдаётся с HttpOnly, Secure и SameSite',
    file: 'lib/auth/login.ts',
    find: "    sameSite: 'lax',",
    replace: "    sameSite: 'none',",
    tests: '__tests__/auth/login.test.tsx',
  },
  {
    id: 'cookie-never-expires',
    claim: 'выдать cookie без срока жизни',
    mustRedden: 'срок жизни cookie — двенадцать часов',
    alsoRedden: [
      {
        name: 'просроченная cookie не пускает',
        why: 'вместе со сроком жизни пропадает и сама просроченность: истечь такой cookie нечему',
      },
    ],
    file: 'lib/auth/session.ts',
    find: 'const SESSION_MS = SESSION_HOURS * 60 * 60 * 1000',
    replace: 'const SESSION_MS = 100 * 365 * 24 * 60 * 60 * 1000',
    tests: '__tests__/auth/session.test.ts',
  },
  {
    id: 'forged-signature-accepted',
    claim: 'принять cookie с подделанной подписью',
    mustRedden: 'cookie с чужой подписью не пускает',
    alsoRedden: [
      {
        name: 'подделанный срок годности узнаётся по подписи, а не принимается на веру',
        why: 'непроверяемая подпись перестаёт сторожить и срок: продлённая cookie читается как своя',
      },
    ],
    file: 'lib/auth/session.ts',
    find: "  if (принесённая.length !== своя.length) return 'подпись чужая'\n  if (!timingSafeEqual(Buffer.from(принесённая, 'utf8'), Buffer.from(своя, 'utf8')))\n    return 'подпись чужая'\n",
    replace: '',
    tests: '__tests__/auth/session.test.ts',
  },
  {
    id: 'expired-accepted',
    claim: 'принять просроченную cookie',
    mustRedden: 'просроченная cookie не пускает',
    file: 'lib/auth/session.ts',
    find: "  if (сейчас > Number(срок)) return 'просрочена'\n",
    replace: '',
    tests: '__tests__/auth/session.test.ts',
  },
  {
    id: 'no-secret-lets-through',
    claim: 'пускать при неназванном секрете',
    mustRedden: 'неназванный секрет подписи — отказ, называющий переменную и что сделать',
    file: 'lib/auth/session.ts',
    find: "  if (секрет === undefined || секрет === '') return 'нет секрета'",
    replace: "  if (секрет === undefined || секрет === '') return 'годна'",
    tests: '__tests__/auth/session.test.ts',
  },
  {
    id: 'key-by-value-off',
    claim: 'убрать приём ключа Google значением',
    mustRedden: 'ключ берётся из значения переменной',
    alsoRedden: [
      {
        name: 'при обеих заданных переменных берётся значение',
        why: 'старшинство значения проверяется тем же разобранным ключом: не дойдя до авторизации, доказывать нечего',
      },
    ],
    file: 'lib/ingest/google-access.ts',
    find: '    return new GoogleAuth({\n      scopes: [scope],\n      credentials: { client_email: ключ.client_email, private_key: ключ.private_key },\n    })',
    replace: '    return new GoogleAuth({ scopes: [scope] })',
    tests: '__tests__/ingest/google-key.test.ts',
  },
  {
    id: 'key-by-path-off',
    claim: 'убрать приём ключа Google через файл',
    mustRedden: 'ключ берётся из файла по пути',
    file: 'lib/ingest/google-access.ts',
    find: '  return new GoogleAuth({ scopes: [scope] })',
    replace:
      "  return new GoogleAuth({\n    scopes: [scope],\n    credentials: { client_email: 'никто@нигде.iam', private_key: 'ключа нет' },\n  })",
    tests: '__tests__/ingest/google-key.test.ts',
  },
  {
    id: 'path-wins-over-value',
    claim: 'дать пути старшинство над значением',
    mustRedden: 'при обеих заданных переменных берётся значение',
    file: 'lib/ingest/google-access.ts',
    find: '  const значением = env.GOOGLE_SERVICE_ACCOUNT_KEY',
    replace:
      '  const значением = env.GOOGLE_APPLICATION_CREDENTIALS\n    ? undefined\n    : env.GOOGLE_SERVICE_ACCOUNT_KEY',
    tests: '__tests__/ingest/google-key.test.ts',
  },
  {
    id: 'refusal-prints-key',
    claim: 'напечатать часть ключа в тексте отказа',
    mustRedden: 'отказ называет только имя недостающей переменной',
    file: 'lib/ingest/google-access.ts',
    find: '        throw new Error(`GOOGLE_SERVICE_ACCOUNT_KEY: в ключе нет поля ${поле} — ${ЧТО_ПОЛОЖИТЬ}`)',
    replace:
      '        throw new Error(\n          `GOOGLE_SERVICE_ACCOUNT_KEY: в ключе нет поля ${поле} — ${ЧТО_ПОЛОЖИТЬ}. Прислано: ${значением}`,\n        )',
    tests: '__tests__/ingest/google-key.test.ts',
  },
  {
    id: 'db-refusal-swallowed',
    claim: 'расширить перехват отказа на странице обратно',
    mustRedden: 'отказ базы летит наружу, а не показывается страницей с кодом «всё хорошо»',
    file: 'app/page.tsx',
    find: '    if (monthParam === undefined || ФОРМА_МЕСЯЦА.test(monthParam)) throw error\n',
    replace: '',
    tests: '__tests__/auth/guarded-paths.test.tsx',
  },
  {
    id: 'guard-lets-through-without-request',
    claim: 'завести в стороже разрешающую ветку на «нет запроса»',
    mustRedden: 'отсутствие запроса — это отказ, а не проход',
    file: 'lib/auth/guard.ts',
    find: "    if (отказ instanceof Error && отказ.message.includes(ВНЕ_ЗАПРОСА)) return 'отказать'",
    replace:
      "    if (отказ instanceof Error && отказ.message.includes(ВНЕ_ЗАПРОСА))\n      return env.NODE_ENV === 'production' ? 'отказать' : 'пускать'",
    tests: '__tests__/auth/guard.test.ts',
  },
]
