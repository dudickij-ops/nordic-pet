import { NextResponse, type NextRequest } from 'next/server'

import { SESSION_COOKIE, ИМЯ_СЕКРЕТА, проверить } from '@/lib/auth/session'

/**
 * Первый слой закрытия: **закрыто всё, кроме перечисленных исключений**.
 *
 * Не «закрываем перечисленные пути». Разница вся в завтрашнем пути: перечень закрываемого
 * оставляет его открытым по забывчивости, а перечень исключений — закрытым, пока кто-то
 * сознательно не впишет его сюда.
 *
 * Файл называется `proxy.ts`, а не `middleware.ts`, потому что в Next 16 прежнее имя
 * объявлено устаревшим самой библиотекой: сборка печатает «The "middleware" file convention
 * is deprecated. Please use "proxy" instead», и документация подтверждает — «The `middleware`
 * file convention is deprecated and has been renamed to `proxy`»
 * (nextjs.org/docs/app/api-reference/file-conventions/proxy). Оттуда же среда исполнения:
 * «Proxy defaults to using the Node.js runtime», поэтому проверка подписи идёт здесь тем же
 * кодом на `node:crypto`, что и во втором слое.
 *
 * **Этот слой — не единственный сторож, и один он не считается.** У страницы отчёта и у
 * серверного действия кнопки есть свои собственные сторожа (`lib/auth/guard.ts`), и это
 * прямое требование документации: «Always verify authentication and authorization inside
 * each Server Function rather than relying on Proxy alone» (там же, «Execution order»).
 * Здешняя работа — закрывать то, о чём никто не подумал.
 */

/**
 * Список исключений. Сегодня — одна строка, и каждая строка требует довода в теле pull
 * request: открытый адрес без объяснения читается как дыра, с объяснением — как выбор.
 *
 * `/health` открыта потому, что отдаёт **только** номер коммита — не экран и не данные, — а
 * своё единственное дело с S0, отличать «выложилось новое» от «браузер показал старое», за
 * паролем делать не сможет. Что она не отдаёт ничего сверх номера, сторожит своя проверка.
 *
 * Растущий список — признак, что защиту пора пересматривать, а не пополнять.
 */
export const ИСКЛЮЧЕНИЯ = ['/health'] as const

/**
 * Страница входа. Исключением она не является: она ничего не отдаёт — ни чисел, ни ссылок
 * на отчёт — и существует ради того, чтобы получить cookie. Не пускать сюда без cookie
 * значило бы не пускать никуда и никогда.
 */
const ВХОД = '/login'

export function proxy(request: NextRequest): NextResponse {
  const путь = request.nextUrl.pathname

  if ((ИСКЛЮЧЕНИЯ as readonly string[]).includes(путь)) return NextResponse.next()
  if (путь === ВХОД) return NextResponse.next()

  // Секрет читается здесь, а не запоминается при загрузке файла: значение переменных
  // окружения на хостинге меняют без пересборки, а запомненное однажды жило бы до неё.
  const состояние = проверить(
    request.cookies.get(SESSION_COOKIE)?.value,
    process.env[ИМЯ_СЕКРЕТА],
    Date.now(),
  )
  if (состояние === 'годна') return NextResponse.next()

  // Причина отказа наружу не выносится ни кодом ответа, ни адресом: посетитель во всех
  // случаях видит одно и то же — страницу входа.
  return NextResponse.redirect(new URL(ВХОД, request.nextUrl))
}

/**
 * Образец путей, на которых слой работает.
 *
 * Из-под него выведены только сборочные файлы Next — `_next/static`, `_next/image` и значок
 * вкладки. Довод: это файлы сборки, одинаковые для всех посетителей, чисел отчёта в них нет
 * (страница отчёта помечена `force-dynamic` и заранее не отрисовывается), а закрытые они
 * ломают саму страницу входа — ей нечем нарисоваться. Тот же приём показывает и
 * документация Next, раздел «Negative matching». Это выведение названо в теле pull request
 * отдельной строкой, наравне с исключением `/health`.
 *
 * Обращения за данными маршрутов (`_next/data`) из-под слоя **не** выводятся: Next зовёт
 * его на них всегда, нарочно — «to prevent accidental security issues where you might
 * protect a page but forget to protect the corresponding data route» (там же).
 *
 * Значение обязано быть постоянным литералом: Next разбирает его при сборке и вычисленное
 * значение молча выбросит.
 */
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
