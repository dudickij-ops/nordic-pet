import type { Break } from './types.ts'

/**
 * Список сломов куска S7 — папка рекламы на общем диске.
 *
 * Файл назван по куску S3, потому что правится код S3: чтение папки `ads-exports`. Своего
 * списка у S3 не было — приборы завелись позже, с S4, и защиты S3 показывались сломами
 * руками в свой черёд. Дописывание тех защит в прибор — отложенная задача, названная в теле
 * pull request.
 *
 * Пять строк. Четыре про общие диски: список папки и скачивание файла — два разных
 * обращения, и поддержка общих дисков нужна каждому своя. Пятая — про строку отказа,
 * которая говорит человеку, что сделать. Ссылаемся на сломы по имени, а не по номеру:
 * вставка нового сдвигает номера, и текст, написанный номерами, начинает врать молча.
 *
 * `list-corpora-set` ломает в обратную сторону — не снятием строки, а её появлением. Так
 * и должно быть: утверждение здесь отрицательное — область поиска не задаётся, умолчание
 * остаётся за Диском, — и отрицается оно только тем, что кто-то её задал. Решение принято
 * владельцем 4 сентября 2026 года по итогам проверки кода: значение `allDrives` завело бы
 * поиск по нескольким собраниям сразу, для которого справочник называет неполную выдачу,
 * а неполный список папки у нас отказ.
 *
 * `zero-csv-loses-shared-drive-hint` сторожит вторую половину той же беды: папка на общем
 * диске, к которому служебному аккаунту доступ не открыт. Отказ про ноль выгрузок при этом
 * правдив и уводит в сторону, а такое хуже отсутствия причины.
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
    id: 'list-corpora-set',
    claim: 'задать области поиска значение «все диски»',
    mustRedden: 'список папки не задаёт область поиска — умолчание остаётся за Диском',
    file: 'lib/ingest/drive-source.ts',
    find: "  url.searchParams.set('includeItemsFromAllDrives', 'true')\n",
    replace:
      "  url.searchParams.set('includeItemsFromAllDrives', 'true')\n" +
      "  url.searchParams.set('corpora', 'allDrives')\n",
    tests: '__tests__/ingest/drive-source.test.ts',
  },
  {
    id: 'zero-csv-loses-shared-drive-hint',
    claim: 'убрать из отказа «ноль выгрузок» указание про доступ к общему диску',
    mustRedden: 'отказ на ноль выгрузок называет доступ к общему диску',
    file: 'lib/ingest/drive-source.ts',
    find:
      "'бы из базы всё, что там есть. Если папка лежит на общем диске, откройте служебному ' +\n" +
      "        'аккаунту доступ к самому общему диску: доступа к одной папке на нём мало' +",
    replace: "'бы из базы всё, что там есть' +",
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
