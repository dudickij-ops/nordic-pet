import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * Настройка для генератора снимков — кусок S10.
 *
 * Отдельная от `vitest.config.ts` нарочно: генератор **пишет файлы в репозиторий**, и ему нечего
 * делать в обычном прогоне проверок. `npm test` собирает только `__tests__/**`, и потому запуск
 * проверок ничего не меняет на диске.
 *
 * Vitest здесь — не проверяющий, а исполнитель: он умеет разбирать JSX и разрешать пути вида
 * `@/…`, а `node` не умеет ни того ни другого. Генератору нужна настоящая разметка приложения,
 * значит нужен и тот, кто её соберёт.
 */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['docs/screens/run*.tsx'],
    fileParallelism: false,
    testTimeout: 180_000,
  },
})
