'use client'

import { useActionState } from 'react'

import type { ИсходВхода } from '@/lib/auth/login'
import { loginAction } from './action'

/** До первой попытки панель ничего не знает про отказ. */
const НАЧАЛО: ИсходВхода = { ok: true }

/**
 * Вид страницы входа — чистый компонент без единого хука.
 *
 * Разделён так же и по той же причине, что панель кнопки в S5: клиентский компонент на
 * `useActionState` в проверке без клиентского окружения не отрисовать, а тогда половина
 * требований — что отказ виден, что пароля в разметке нет — не была бы сторожена ничем.
 *
 * На этой странице нет ни одного числа отчёта и ни одной ссылки на него: она существует
 * ради того, чтобы получить cookie, и больше ни ради чего.
 */
export function LoginView({ исход, ждём }: { исход: ИсходВхода; ждём: boolean }) {
  return (
    <main>
      <h1>Nordic Pet — вход</h1>

      <label htmlFor="login">Логин</label>
      <input id="login" name="login" type="text" autoComplete="username" required />

      <label htmlFor="password">Пароль</label>
      <input id="password" name="password" type="password" autoComplete="current-password" required />

      <button type="submit" disabled={ждём}>
        Войти
      </button>

      {исход.ok === false && <p role="alert">{исход.text}</p>}
    </main>
  )
}

/**
 * Страница входа целиком: форма и её серверное действие.
 *
 * Единственная работа обёртки — достать исход и «ждём» из `useActionState` и отдать их виду.
 * Ни сверки, ни текста отказа она не решает: это дело `lib/auth/login.ts`.
 */
export function LoginForm() {
  const [исход, отправить, ждём] = useActionState(loginAction, НАЧАЛО)

  return (
    <form action={отправить}>
      <LoginView исход={исход} ждём={ждём} />
    </form>
  )
}
