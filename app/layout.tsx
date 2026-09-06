import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'

/*
 * Единственная точка ввоза таблицы стилей — кусок S9. Документация Next показывает ровно это:
 * «Create a `app/global.css` file and import it in the root layout to apply the styles to
 * **every route** in your application» (nextjs.org/docs/app/getting-started/css, «Global CSS»);
 * там же, в «Recommendations», — «Try to contain CSS imports to a single JavaScript or
 * TypeScript entry file».
 *
 * Наш вывод из этого — наш, а не документации: держать ввоз только здесь заодно оставляет
 * проверки экрана без CSS вовсе. Они отрисовывают разметку в узел и о стилях ничего не
 * утверждают; ввоз стилей в файл, который читают проверки, потащил бы CSS в их среду без нужды.
 */
import './globals.css'

export const metadata: Metadata = {
  title: 'Nordic Pet',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  )
}
