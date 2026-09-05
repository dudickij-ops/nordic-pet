import { logoutAction } from './logout-action'

/**
 * Кнопка выхода — задача 3 куска S8.
 *
 * Форма, а не ссылка: выход меняет состояние (убирает cookie), а по ссылке ходят и предзагрузчики
 * браузера. Вида у неё пока никакого — вид экрана делает следующий кусок.
 */
export function LogoutButton() {
  return (
    <form action={logoutAction}>
      <button type="submit">Выйти</button>
    </form>
  )
}
