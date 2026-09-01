import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * Живые проверки: настоящий поход в Google и настоящая запись в базу.
 *
 * Они вынесены в отдельный набор не флагом пропуска, а именем файла: `*.live.ts` не
 * подходит под образец обычного набора вовсе. Проверка, которая молча исчезает вместе
 * со средой, — не проверка; эта при отсутствии ключей краснеет.
 *
 * В `ci` набор не идёт: ключей служебного аккаунта там нет и не будет.
 */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['__tests__/live/**/*.live.ts'],
    // Сеть и пятьсот строк не укладываются в обычные пять секунд.
    testTimeout: 120_000,
  },
})
