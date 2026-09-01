import net from 'node:net'

/**
 * Перекрытый выход наружу.
 *
 * Обещание «команда не ходит в сеть» через разбор списка импортов не доказывается и не
 * докажется: реэкспорт, динамический импорт, голый `fetch`, а завтра что-нибудь ещё — это
 * гонка, в которой сторож всегда на шаг позади. Здесь обещание держится на наблюдении:
 * на время работы выход наружу перекрыт, и всякий стук в него записан.
 *
 * Обойти это нечем, кроме настоящего отказа от сети.
 */

export type BlockedNetwork = {
  /** Куда постучались, пока выход был перекрыт. */
  knocks: string[]
  /** Проверяет, что ловушка вправду ловит: без этого «стуков нет» ничего не значит. */
  proveTrapWorks: () => void
  restore: () => void
}

/** Куда пускаем: только местная база проекта. Всё прочее — наружу. */
function isLocalDatabase(host: string, port: number): boolean {
  return (host === '127.0.0.1' || host === 'localhost' || host === '::1') && port === 5432
}

export function blockNetwork(options: { allowLocalDatabase: boolean }): BlockedNetwork {
  const knocks: string[] = []

  const realConnect = net.Socket.prototype.connect
  const realFetch = globalThis.fetch

  net.Socket.prototype.connect = function patched(
    this: net.Socket,
    ...args: Parameters<typeof realConnect>
  ) {
    // Драйвер базы зовёт с объектом, прочие — то с объектом, то парой «порт, хост».
    const first = args[0] as unknown
    const host =
      typeof first === 'object' && first !== null
        ? String((first as { host?: string }).host ?? '')
        : String(args[1] ?? '')
    const port =
      typeof first === 'object' && first !== null
        ? Number((first as { port?: number }).port ?? 0)
        : Number(first)

    if (options.allowLocalDatabase && isLocalDatabase(host, port)) {
      return realConnect.apply(this, args)
    }

    knocks.push(`сокет ${host}:${port}`)
    throw new Error('выход наружу перекрыт проверкой')
  } as typeof realConnect

  globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
    knocks.push(`fetch ${String(args[0])}`)
    throw new Error('выход наружу перекрыт проверкой')
  }) as typeof fetch

  return {
    knocks,
    proveTrapWorks() {
      const before = knocks.length
      let stopped = false
      try {
        void globalThis.fetch('http://наружу.invalid/')
      } catch {
        stopped = true
      }
      if (!stopped || knocks.length !== before + 1) {
        throw new Error('ловушка не ловит: «стуков нет» ничего не доказывало бы')
      }
      knocks.length = before
    },
    restore() {
      net.Socket.prototype.connect = realConnect
      globalThis.fetch = realFetch
    },
  }
}
