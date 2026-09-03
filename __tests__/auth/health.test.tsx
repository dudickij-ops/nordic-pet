import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, test } from 'vitest'

import HealthPage from '@/app/health/page'

/**
 * Единственный открытый адрес — задача 3 куска S6.
 *
 * `/health` остаётся открытой потому, что отдаёт только номер коммита: своё единственное
 * дело с S0 — отличать «выложилось новое» от «браузер показал старое» — за паролем она
 * делать не сможет. Условие владельца к этому исключению: она отдаёт **ровно** номер
 * коммита и ничего сверх. Поэтому проверка сравнивает весь её текст целиком, а не ищет в
 * нём подстроку: подстрока не заметит ни одного добавленного слова.
 *
 * Принятая проверка S0 `__tests__/health-page.test.tsx` сторожит другое — откуда берётся
 * номер, — и не открывается: эта дописана рядом.
 */

const НОМЕР = '0123456789abcdef0123456789abcdef01234567'
const прежний = process.env.VERCEL_GIT_COMMIT_SHA

afterEach(() => {
  if (прежний === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA
  else process.env.VERCEL_GIT_COMMIT_SHA = прежний
})

test('/health отдаёт ровно номер коммита', () => {
  process.env.VERCEL_GIT_COMMIT_SHA = НОМЕР

  const текст = renderToStaticMarkup(<HealthPage />)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  expect(текст).toBe(`Состояние Коммит: ${НОМЕР}`)
})
