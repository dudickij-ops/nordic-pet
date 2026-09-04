import type { Break } from './types.ts'

/**
 * Список сломов куска S7 — папка рекламы на общем диске.
 *
 * Файл назван по куску S3, потому что правится код S3: чтение папки `ads-exports`. Своего
 * списка у S3 не было — приборы завелись позже, с S4, и защиты S3 показывались сломами
 * руками в свой черёд. Дописывание тех защит в прибор — отложенная задача, названная в теле
 * pull request.
 *
 * Шесть строк. Четыре про состав двух запросов: список папки и скачивание файла — разные
 * обращения, и поддержка общих дисков нужна каждому своя. Две про тексты отказов, которые
 * говорят человеку, что делать. Ссылаемся на сломы по имени, а не по номеру: вставка нового
 * сдвигает номера, и текст, написанный номерами, начинает врать молча.
 *
 * `zero-csv-loses-shared-drive-hint` сторожит половину беды, которую человек чинит руками:
 * папка на общем диске, к которому служебному аккаунту доступ не открыт. Отказ про ноль
 * выгрузок при этом правдив и уводит в сторону, а такое хуже отсутствия причины.
 *
 * `incomplete-list-loses-shared-drive-hint` сторожит цену, которую справочник называет у
 * поиска сразу по всем дискам, — целиком и с условием: «if the combined corpora is too large,
 * the API might return incomplete results». Наш вывод, помеченный как наш: условие про большое
 * совокупное собрание к запросу по одной папке относится слабо, поэтому цену мы принимаем —
 * состав запроса взят из готового примера руководства, — но не прячем: наш отказ на неполный
 * список обязан назвать общий диск и сказать, что делать. Без этого слома «громко» осталось
 * бы обещанием.
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
    claim: 'оставить область поиска умолчанию — без общих дисков',
    mustRedden: 'список папки ищет по всем дискам, а не только по личному',
    file: 'lib/ingest/drive-source.ts',
    find: "  url.searchParams.set('corpora', 'allDrives')\n",
    replace: '',
    tests: '__tests__/ingest/drive-source.test.ts',
  },
  {
    id: 'incomplete-list-loses-shared-drive-hint',
    claim: 'убрать из отказа «неполный список» указание про общий диск',
    mustRedden: 'отказ на неполный список называет общий диск и говорит, что делать',
    file: 'lib/ingest/drive-source.ts',
    find:
      "'не попавших в список, были бы удалены из базы. Запустите загрузку заново. Если ' +\n" +
      "          'это повторяется, а папка лежит на общем диске, скорее всего дело в поиске сразу ' +\n" +
      "          'по всем дискам: скажите об этом разработчику и назовите свой общий диск — поиск ' +\n" +
      "          'нужно сузить до него одного',",
    replace: "'не попавших в список, были бы удалены из базы. Запустите загрузку заново',",
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
