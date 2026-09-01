import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['__tests__/**/*.test.{ts,tsx}'],
    // Файлы проверок идут по очереди, а не вперемешку. База в проекте одна на все
    // проверки, и часть из них пишет в сырые таблицы целыми снимками: запись снимка
    // обновляет и удаляет те же строки, которые в этот момент держит соседний файл.
    // Два таких файла, запущенные разом, встают в замок друг против друга, и Postgres
    // рвёт один из них ошибкой «deadlock detected». Проверено: без последовательного
    // порядка тот же набор краснел в четырёх прогонах из восьми, причём краснела не та
    // проверка, которую меняли.
    fileParallelism: false,
  },
})
