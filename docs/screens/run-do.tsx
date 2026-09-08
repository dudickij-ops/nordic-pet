import { expect, test, vi } from 'vitest'

/**
 * Три пары «до» — то, с чем владелец будет сравнивать вид после куска.
 *
 * Снимается **до первой правки оформления** и кладётся в `docs/screens/do/`. После правки та же
 * тройка снимается обычной командой в `docs/screens/`, и пара оказывается рядом.
 */
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const { собратьСнимки } = await import('./generate.tsx')

test('снимки «до» собраны: две страницы и три картинки', () => {
  const { страницы, картинки } = собратьСнимки({
    куда: new URL('do/', import.meta.url).pathname,
    толькоПары: true,
  })

  expect(страницы).toHaveLength(2)
  expect(картинки).toHaveLength(3)
}, 180_000)
