import type { Break } from './types.ts'

/**
 * Список сломов куска S7 — папка рекламы на общем диске.
 *
 * Файл назван по куску S3, потому что правится код S3: чтение папки `ads-exports`. Своего
 * списка у S3 не было — приборы завелись позже, с S4, и защиты S3 показывались сломами
 * руками в свой черёд. Дописывание тех защит в прибор — отложенная задача, названная в теле
 * pull request; здесь четыре строки, и все четыре про общие диски.
 *
 * Четыре, а не три, потому что список папки и скачивание файла — два разных обращения, и
 * поддержка общих дисков нужна каждому своя. Ссылаемся на сломы по имени, а не по номеру:
 * вставка нового сдвигает номера, и текст, написанный номерами, начинает врать молча.
 *
 * `list-corpora-default` отрицает решение контракта самым точным способом — не заменой
 * значения на другое, а снятием строки: тогда область поиска остаётся умолчанием `user`,
 * то есть ровно тем, чем она была бы, не прими мы решения вовсе.
 *
 * Образцы замены берут соседнюю строку нарочно: `supportsAllDrives` стоит в файле дважды —
 * у списка и у скачивания, — и образец из одной этой строки прибор назвал бы двусмысленным.
 *
 * Чего этими сломами не доказано: поведения Google на настоящем общем диске. Его мы не
 * наблюдали и наблюдать нам нечем — общего диска у нас нет. Доказано, что запрос уходит с
 * теми параметрами, которые справочник называет необходимыми, и что снятие любого из них
 * краснит свою и только свою проверку.
 */

export const BREAKS: Break[] = [
  {
    id: 'list-supports-off',
    claim: 'снять `supportsAllDrives` с запроса списка папки',
    mustRedden: 'список папки просит поддержку общих дисков',
    file: 'lib/ingest/drive-source.ts',
    find:
      "  url.searchParams.set('supportsAllDrives', 'true')\n" +
      "  url.searchParams.set('includeItemsFromAllDrives', 'true')",
    replace: "  url.searchParams.set('includeItemsFromAllDrives', 'true')",
    tests: '__tests__/ingest/drive-source.test.ts',
  },
  {
    id: 'list-include-off',
    claim: 'снять `includeItemsFromAllDrives` с запроса списка папки',
    mustRedden: 'список папки включает в ответ файлы общих дисков',
    file: 'lib/ingest/drive-source.ts',
    find: "  url.searchParams.set('includeItemsFromAllDrives', 'true')\n",
    replace: '',
    tests: '__tests__/ingest/drive-source.test.ts',
  },
  {
    id: 'list-corpora-default',
    claim: 'оставить область поиска на умолчании — только личный диск',
    mustRedden: 'список папки ищет по всем дискам, а не только по личному',
    file: 'lib/ingest/drive-source.ts',
    find: "  url.searchParams.set('corpora', 'allDrives')\n",
    replace: '',
    tests: '__tests__/ingest/drive-source.test.ts',
  },
  {
    id: 'media-supports-off',
    claim: 'снять `supportsAllDrives` с запроса содержимого файла',
    mustRedden: 'содержимое файла просится с поддержкой общих дисков',
    file: 'lib/ingest/drive-source.ts',
    find: "  url.searchParams.set('supportsAllDrives', 'true')\n  return url.toString()",
    replace: '  return url.toString()',
    tests: '__tests__/ingest/drive-source.test.ts',
  },
]
