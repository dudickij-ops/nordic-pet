import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { ОтказСнимка, сверитьКадр } from '@/docs/screens/guards'
import { собратьСнимки, type Браузер } from '@/docs/screens/generate'

/**
 * Сторож кадра — кусок S11, условие 5 владельца к развилке Ж1: водопад и ряд по дням на снимках
 * «Главного» обязаны уместиться в кадр целиком.
 *
 * Своим файлом, а не дописью к принятым проверкам генератора: их подставной браузер отвечает на любой
 * замер шириной окна, и на замер кадра он отвечает не краем разделов. Здесь подставной браузер отвечает
 * на замер кадра отдельно — тем числом, которое проверке нужно.
 */

const ВРЕМЕННЫЕ: string[] = []

function временный(имя: string): string {
  const путь = mkdtempSync(join(tmpdir(), `${имя}-`))
  ВРЕМЕННЫЕ.push(путь)
  return путь
}

afterEach(() => {
  while (ВРЕМЕННЫЕ.length > 0) rmSync(ВРЕМЕННЫЕ.pop() as string, { recursive: true, force: true })
})

function отказ(действие: () => unknown): ОтказСнимка {
  try {
    действие()
  } catch (ошибка) {
    if (ошибка instanceof ОтказСнимка) return ошибка
    throw new Error(`ожидался наш отказ, а пришло: ${String(ошибка)}`)
  }
  throw new Error('ожидался отказ, а вызов прошёл молча')
}

/** Подставной браузер: ширину отдаёт честно, на замер кадра отвечает заданным краем. */
function подставной(край: number): Браузер {
  return (зачем, доводы) => {
    const снимок = доводы.find((д) => д.startsWith('--screenshot='))
    const страница = (доводы[доводы.length - 1] ?? '').replace('file://', '')
    if (снимок !== undefined) {
      writeFileSync(снимок.slice('--screenshot='.length), createHash('sha256').update(readFileSync(страница, 'utf8')).digest('hex'))
      return ''
    }
    if (зачем.startsWith('замер кадра')) return `<html><head><title>${край}</title></head></html>`
    const ширина = Number(/--window-size=(\d+),/.exec(доводы.join(' '))?.[1] ?? 0)
    return `<html><head><title>${ширина}</title></head></html>`
  }
}

test('сторож кадра пропускает край по кадру и отказывает на крае ниже кадра', () => {
  expect(() => сверитьКадр('проба.png', 1700, 1700)).not.toThrow()
  expect(отказ(() => сверитьКадр('проба.png', 1701, 1700)).вид).toBe('кадр обрезан')
})

test('генератор отказывает, когда нижний край водопада или ряда ниже края кадра', () => {
  const пойман = отказ(() =>
    собратьСнимки({ куда: временный('снимки'), толькоПары: true, браузер: подставной(99_999) }),
  )
  expect(пойман.вид).toBe('кадр обрезан')
  expect(пойман.message).toContain('01-obychnyy-shirokiy-svetlaya.png')
})

test('замер кадра без ответа — отказ замера, а не ноль', () => {
  const пойман = отказ(() =>
    собратьСнимки({ куда: временный('снимки'), толькоПары: true, браузер: подставной(0) }),
  )
  expect(пойман.вид).toBe('замер не удался')
})

test('край в пределах кадра — снимки собраны', () => {
  const итог = собратьСнимки({ куда: временный('снимки'), толькоПары: true, браузер: подставной(1200) })
  expect(итог.картинки).toHaveLength(3)
})
