# Выписки оформления с сайта nordicpet.lt

**Что это.** Сбор доказательств для дашборда Nordic Pet: свойства оформления, снятые с живого
сайта магазина через `getComputedStyle` в браузере. Не правка кода, ничего в репозитории не
менялось.

**Дата захода:** 18.09.2026.

**Ширина окна при съёмке:** 1440 × 900 (эмуляция вьюпорта). Все размеры и отступы относятся к
этой ширине.

**Страницы, с которых снято:**

| Адрес | Что с неё взято |
| --- | --- |
| https://nordicpet.lt/ | корень и основной текст, тёмный первый экран, кнопки первого экрана, шапка, ширина колонки |
| https://nordicpet.lt/parduotuve/ | карточка товара, кнопка «в корзину» в карточке, подвал |
| https://nordicpet.lt/produktas/susokantis-medzio-kraikas-katems-prenumerata/ | h1 товара, цена, подписи мелким, кнопка главного действия, ссылки и наведение |
| https://nordicpet.lt/kontaktai/ | h1 обычной страницы, признак выбранного пункта меню, тёмная плашка заголовка |

**Печеньки.** На первом заходе всплыло окно «Vertiname jūsų privatumą» с тремя кнопками:
«Priimti viską» (принять всё), «Pritaikyti» (настроить), «Atmesti» (отклонить). Нажат
**«Atmesti»**. Условия не принимались, формы не заполнялись, вход никуда не выполнялся,
ничего не покупалось и не скачивалось.

---

## 1. Корень страницы и основной текст

| Свойство | Значение как вернул браузер | Где снято |
| --- | --- | --- |
| font-family | `sans-serif` | `/`, селектор `html` |
| font-size | `16px` | `/`, `html` |
| font-weight | `400` | `/`, `html` |
| line-height | `16px` | `/`, `html` |
| letter-spacing | `normal` | `/`, `html` |
| color | `rgb(0, 0, 0)` | `/`, `html` |
| background-color | `rgba(0, 0, 0, 0)` | `/`, `html` |

| Свойство | Значение как вернул браузер | Где снято |
| --- | --- | --- |
| font-family | `Barlow, Arial, Helvetica, sans-serif` | `/`, селектор `body` |
| font-size | `16px` | `/`, `body` |
| font-weight | `400` | `/`, `body` |
| line-height | `25.6px` | `/`, `body` |
| letter-spacing | `normal` | `/`, `body` |
| color | `rgb(66, 66, 66)` | `/`, `body` |
| background-color | `rgb(255, 255, 255)` | `/`, `body` |

Абзац содержимого на главной (`p` внутри `.elementor-widget-container`):

| Свойство | Значение как вернул браузер | Где снято |
| --- | --- | --- |
| font-family | `Barlow, sans-serif` | `/`, `.elementor-widget-container > p` |
| font-size | `18px` | там же |
| font-weight | `400` | там же |
| line-height | `32.4px` | там же |
| letter-spacing | `normal` | там же |
| color | `rgb(13, 13, 13)` | там же |

Абзац содержимого на странице товара и на «Контактах» — другой набор:

| Свойство | Значение как вернул браузер | Где снято |
| --- | --- | --- |
| font-family | `"Exo 2", sans-serif` | `/produktas/susokantis-medzio-kraikas-katems-prenumerata/`, `.elementor-widget-container p` |
| font-size | `17px` | там же |
| font-weight | `400` | там же |
| line-height | `30.6px` | там же |
| letter-spacing | `normal` | там же |
| color | `rgb(13, 13, 13)` | там же |
| color (на тёмной странице) | `rgb(255, 255, 255)` | `/kontaktai/`, тот же селектор |

Переменные темы, объявленные на корне (`getComputedStyle(document.documentElement).getPropertyValue`):

| Переменная | Значение как вернул браузер | Где снято |
| --- | --- | --- |
| `--wd-text-font` | `"Barlow", Arial, Helvetica, sans-serif` | `/`, `:root` |
| `--wd-title-font` | `"Barlow", Arial, Helvetica, sans-serif` | `/`, `:root` |
| `--wd-text-color` | `rgb(66,66,66)` | `/`, `:root` |
| `--wd-title-color` | `#242424` | `/`, `:root` |
| `--wd-link-color` | `#333333` | `/`, `:root` |
| `--wd-link-color-hover` | `#242424` | `/`, `:root` |
| `--wd-primary-color` | `rgb(126,191,154)` | `/`, `:root` |
| `--wd-alternative-color` | `#fbbc34` | `/`, `:root` |
| `--btn-accented-bgcolor` | `rgb(126,191,154)` | `/`, `:root` |
| `--btn-default-bgcolor` | `#f7f7f7` | `/`, `:root` |
| `--wd-form-brd-radius` | `0px` | `/`, `:root` |

---

## 2. Заголовки h1–h3 и подписи мелким

### h1

На главной странице элемента `h1` нет вовсе (`document.querySelectorAll('h1').length` вернул 0).

| Свойство | Значение как вернул браузер | Где снято |
| --- | --- | --- |
| font-family | `"Exo 2", Arial, Helvetica, sans-serif` | страница товара, `h1.product_title.entry-title.wd-entities-title` |
| font-size | `34px` | там же |
| font-weight | `500` | там же |
| line-height | `40.8px` | там же |
| letter-spacing | `normal` | там же |
| color | `rgb(51, 51, 51)` | там же |

| Свойство | Значение как вернул браузер | Где снято |
| --- | --- | --- |
| font-family | `Barlow, Arial, Helvetica, sans-serif` | `/kontaktai/`, `h1.entry-title.title` |
| font-size | `44px` | там же |
| font-weight | `600` | там же |
| line-height | `52.8px` | там же |
| letter-spacing | `normal` | там же |
| color | `rgb(255, 255, 255)` | там же |

### h2

| Свойство | Значение как вернул браузер | Где снято |
| --- | --- | --- |
| font-family | `Rajdhani, sans-serif` | `/`, `h2.elementor-heading-title` («Mūsų istorija») |
| font-size | `24px` | там же |
| font-weight | `600` | там же |
| line-height | `31.2px` | там же |
| letter-spacing | `normal` | там же |
| color | `rgb(13, 13, 13)` | там же |

| Свойство | Значение как вернул браузер | Где снято |
| --- | --- | --- |
| font-family | `Barlow, sans-serif` | `/`, `h2.elementor-heading-title` («Mažmeninės prekybos galimybės») |
| font-size | `24px` | там же |
| font-weight | `600` | там же |
| line-height | `31.2px` | там же |
| letter-spacing | `normal` | там же |
| color | `rgb(13, 13, 13)` | там же |

| Свойство | Значение как вернул браузер | Где снято |
| --- | --- | --- |
| font-family | `Barlow, Arial, Helvetica, sans-serif` | страница товара, `h2` описания |
| font-size | `24px` | там же |
| font-weight | `600` | там же |
| line-height | `33.6px` | там же |
| letter-spacing | `normal` | там же |
| color | `rgb(36, 36, 36)` | там же |

| Свойство | Значение как вернул браузер | Где снято |
| --- | --- | --- |
| font-family | `Oswald, sans-serif` | `/kontaktai/`, `h2` («KONTAKTAI») |
| font-size | `65px` | там же |
| font-weight | `500` | там же |
| line-height | `65px` | там же |
| letter-spacing | `normal` | там же |
| color | `rgb(255, 255, 255)` | там же |

| Свойство | Значение как вернул браузер | Где снято |
| --- | --- | --- |
| font-family | `Abel, sans-serif` | `/kontaktai/`, `h2` («Navigacija») |
| font-size | `24px` | там же |
| font-weight | `600` | там же |
| line-height | `31.2px` | там же |
| letter-spacing | `normal` | там же |
| color | `rgb(255, 255, 255)` | там же |

### h3

| Свойство | Значение как вернул браузер | Где снято |
| --- | --- | --- |
| font-family | `Barlow, sans-serif` | `/`, `h3.elementor-heading-title` — заголовок первого экрана |
| font-size | `41px` | там же |
| font-weight | `600` | там же |
| line-height | `53.3px` | там же |
| letter-spacing | `normal` | там же |
| color | `rgb(255, 255, 255)` | там же |

| Свойство | Значение как вернул браузер | Где снято |
| --- | --- | --- |
| font-family | `"Exo 2", Arial, Helvetica, sans-serif` | страница товара, `h3.wd-entities-title` (название в блоке «Panašūs produktai») |
| font-size | `16px` | там же |
| font-weight | `500` | там же |
| line-height | `22.4px` | там же |
| letter-spacing | `normal` | там же |
| color | `rgb(51, 51, 51)` | там же |

### Подписи мелким

| Свойство | Значение как вернул браузер | Где снято |
| --- | --- | --- |
| font-family | `"Exo 2", sans-serif` | `/`, `span.elementor-icon-list-text` («pasirink kiekį: nuo 5 iki 40l») |
| font-size | `16px` | там же |
| font-weight | `400` | там же |
| line-height | `24px` | там же |
| letter-spacing | `normal` | там же |
| color | `rgb(69, 80, 89)` | там же |

| Свойство | Значение как вернул браузер | Где снято |
| --- | --- | --- |
| font-family | `Barlow, Arial, Helvetica, sans-serif` | страница товара, `a.reset_variations` («Išvalyti») |
| font-size | `12px` | там же |
| font-weight | `400` | там же |
| line-height | `16.8px` | там же |
| letter-spacing | `normal` | там же |
| color | `rgb(118, 118, 118)` | там же |

| Свойство | Значение как вернул браузер | Где снято |
| --- | --- | --- |
| font-family | `"Exo 2", sans-serif` | страница товара, `footer p` («Visos teisės saugomos NordicPet, 20…») |
| font-size | `13px` | там же |
| font-weight | `400` | там же |
| line-height | `23.4px` | там же |
| letter-spacing | `normal` | там же |
| color | `rgb(206, 203, 203)` | там же |

| Свойство | Значение как вернул браузер | Где снято |
| --- | --- | --- |
| font-family | `Barlow, Arial, Helvetica, sans-serif` | `/parduotuve/`, `.add_to_cart_button` — подпись кнопки в карточке |
| font-size | `13px` | там же |
| font-weight | `600` | там же |
| line-height | `15.6px` | там же |
| letter-spacing | `normal` | там же |
| text-transform | `uppercase` | там же |
| color | `rgb(255, 255, 255)` | там же |

---

## 3. Фирменные цвета, кнопки, ссылки

### Зелёный

| Свойство | Значение как вернул браузер | Где снято |
| --- | --- | --- |
| `--wd-primary-color` | `rgb(126,191,154)` | `/`, `:root` |
| `--btn-accented-bgcolor` | `rgb(126,191,154)` | `/`, `:root` |
| border-bottom-color шапки | `rgb(126, 191, 154)` | `/`, `.whb-row.whb-general-header` |
| background-color кнопки первого экрана | `rgb(126, 191, 154)` | `/`, `a.elementor-button` («Kodėl mes?») |
| background-color кнопки «в корзину» | `rgb(126, 191, 154)` | `/parduotuve/`, `.add_to_cart_button` |
| background-color кнопки «Į krepšelį» на товаре | `rgb(126, 191, 154)` | страница товара, `.single_add_to_cart_button` |
| color цены в карточке | `rgb(126, 191, 154)` | `/parduotuve/`, `.product-grid-item .price` |
| color цены на странице товара | `rgb(126, 191, 154)` | страница товара, `.summary .price` |
| color выбранного пункта в выдвижном меню | `rgb(126, 191, 154)` | `/`, `.wd-nav-mobile li.current-menu-item > a` |

Тёмно-зелёный, встречается как цвет рамки и текста второстепенной кнопки:

| Свойство | Значение как вернул браузер | Где снято |
| --- | --- | --- |
| color | `rgb(32, 64, 61)` | `/`, `a.elementor-button` («Susisiekite») |
| border-top-color | `rgb(32, 64, 61)` | там же |
| border-top-color при наведении на жёлтую кнопку шапки | `rgb(32, 64, 61)` | `/`, `.eshop-menu-button > a:hover` |

### Жёлтый (кнопка главного действия в шапке)

| Свойство | Значение как вернул браузер | Где снято |
| --- | --- | --- |
| font-family | `Rajdhani, sans-serif` | `/`, `ul#menu-menu-lithuanian .eshop-menu-button > a` |
| font-size | `17px` | там же |
| font-weight | `700` | там же |
| line-height | `23.8px` | там же |
| letter-spacing | `0.4px` | там же |
| text-transform | `uppercase` | там же |
| color | `rgb(13, 13, 13)` | там же |
| background-color | `rgb(255, 187, 54)` | там же |
| border-top-width | `0px` | там же |
| border-top-style | `none` | там же |
| border-top-color | `rgb(13, 13, 13)` | там же |
| border-radius | `20px` | там же |
| padding-top / bottom | `8px` / `8px` | там же |
| padding-left / right | `22px` / `22px` | там же |
| box-shadow | `none` | там же |
| background-color при наведении | `rgb(126, 191, 154)` | там же, `:hover` наведён мышью |
| border-top-color при наведении | `rgb(32, 64, 61)` | там же, `:hover` |
| color при наведении | `rgb(13, 13, 13)` | там же, `:hover` |

### Зелёная кнопка первого экрана («Kodėl mes?»)

| Свойство | Значение как вернул браузер | Где снято |
| --- | --- | --- |
| font-family | `Rajdhani, sans-serif` | `/`, `a.elementor-button.elementor-size-xs` |
| font-size | `17px` | там же |
| font-weight | `700` | там же |
| line-height | `17px` | там же |
| letter-spacing | `0.4px` | там же |
| text-transform | `none` | там же |
| color | `rgb(13, 13, 13)` | там же |
| background-color | `rgb(126, 191, 154)` | там же |
| border-top-width | `2px` | там же |
| border-top-style | `solid` | там же |
| border-top-color | `rgb(126, 191, 154)` | там же |
| border-radius | `20px` | там же |
| padding-top / bottom | `12px` / `12px` | там же |
| padding-left / right | `57px` / `57px` | там же |
| box-shadow | `none` | там же |
| при наведении: background-color / border-top-color / color | `rgb(126, 191, 154)` / `rgb(126, 191, 154)` / `rgb(13, 13, 13)` | там же, `:hover` наведён мышью — не меняется |

### Кнопка-контур первого экрана («Susisiekite»)

| Свойство | Значение как вернул браузер | Где снято |
| --- | --- | --- |
| font-family | `Rajdhani, sans-serif` | `/`, `a.elementor-button.elementor-size-xs` |
| font-size | `17px` | там же |
| font-weight | `700` | там же |
| line-height | `17px` | там же |
| letter-spacing | `0.4px` | там же |
| text-transform | `none` | там же |
| color | `rgb(32, 64, 61)` | там же |
| background-color | `rgb(255, 255, 255)` | там же |
| border-top-width | `2px` | там же |
| border-top-style | `solid` | там же |
| border-top-color | `rgb(32, 64, 61)` | там же |
| border-radius | `20px` | там же |
| padding-top / bottom | `12px` / `12px` | там же |
| padding-left / right | `44px` / `44px` | там же |
| box-shadow | `none` | там же |
| при наведении: background-color / border-top-color / color | `rgb(126, 191, 154)` / `rgb(126, 191, 154)` / `rgb(13, 13, 13)` | там же, `:hover` наведён мышью |

### Кнопка «Į KREPŠELĮ» на странице товара

| Свойство | Значение как вернул браузер | Где снято |
| --- | --- | --- |
| font-family | `Barlow, Arial, Helvetica, sans-serif` | страница товара, `button.single_add_to_cart_button` |
| font-size | `13px` | там же |
| font-weight | `600` | там же |
| letter-spacing | `normal` | там же |
| text-transform | `uppercase` | там же |
| color | `rgb(255, 255, 255)` | там же |
| background-color | `rgb(126, 191, 154)` | там же |
| border-radius | `0px` | там же |
| border-top-width | `0px` | там же |
| border-top-color | `rgb(233, 233, 233)` | там же |
| padding-top / bottom | `5px` / `5px` | там же |
| padding-left / right | `20px` / `20px` | там же |
| height | `42px` | там же |
| box-shadow | `rgba(0, 0, 0, 0.15) 0px -2px 0px 0px inset` | там же |

### Ссылки

| Свойство | Значение как вернул браузер | Где снято |
| --- | --- | --- |
| `--wd-link-color` | `#333333` | `/`, `:root` |
| `--wd-link-color-hover` | `#242424` | `/`, `:root` |
| color | `rgb(51, 51, 51)` | страница товара, `footer .elementor-icon-list-item a` («KONTAKTAI») |
| color при наведении | `rgb(36, 36, 36)` | там же, `:hover` наведён мышью |
| text-decoration-line | `none` | там же, и в покое, и при наведении |
| text-decoration-color | `rgb(51, 51, 51)` | там же |
| background-color при наведении | `rgba(0, 0, 0, 0)` | там же |
| font-family | `"Exo 2", sans-serif` | там же |
| font-size | `17px` | там же |
| font-weight | `500` | там же |

---

## 4. Карточка товара

Снято на `/parduotuve/`. Внешний элемент `li.product-grid-item` фона и рамки не несёт, всё
оформление на внутреннем `.product-wrapper`.

| Свойство | Значение как вернул браузер | Где снято |
| --- | --- | --- |
| background-color | `rgba(0, 0, 0, 0)` | `/parduotuve/`, `.product-grid-item` |
| border-top-width | `0px` | там же |
| border-top-style | `none` | там же |
| border-radius | `0px` | там же |
| box-shadow | `none` | там же |
| padding (все четыре) | `0px` | там же |
| margin-bottom | `0px` | там же |
| ширина × высота | `282.1640625px` × `440.171875px` | там же, `getBoundingClientRect()` |

| Свойство | Значение как вернул браузер | Где снято |
| --- | --- | --- |
| background-color | `rgba(0, 0, 0, 0)` | `/parduotuve/`, `.product-grid-item .product-wrapper` |
| border-top-width / right / bottom / left | `1px` / `1px` / `1px` / `1px` | там же |
| border-style | `solid` | там же |
| border-top-color / right / bottom / left | `rgba(0, 0, 0, 0.106)` (все четыре) | там же |
| border-radius | `0px` | там же |
| box-shadow | `none` | там же |
| padding-top / right / bottom / left | `15px` / `15px` / `15px` / `15px` | там же |

Текст внутри карточки:

| Свойство | Значение как вернул браузер | Где снято |
| --- | --- | --- |
| название: font-family | `"Exo 2", Arial, Helvetica, sans-serif` | `/parduotuve/`, `.product-grid-item .wd-entities-title` |
| название: font-size | `16px` | там же |
| название: font-weight | `500` | там же |
| название: line-height | `22.4px` | там же |
| название: letter-spacing | `normal` | там же |
| название: color | `rgb(51, 51, 51)` | там же |
| цена: font-family | `Barlow, Arial, Helvetica, sans-serif` | `/parduotuve/`, `.product-grid-item .price` |
| цена: font-size | `16px` | там же |
| цена: font-weight | `400` | там же |
| цена: line-height | `22.4px` | там же |
| цена: color | `rgb(126, 191, 154)` | там же |

Кнопка «Į KREPŠELĮ» внутри карточки:

| Свойство | Значение как вернул браузер | Где снято |
| --- | --- | --- |
| display | `inline-flex` | `/parduotuve/`, `.product-grid-item .add_to_cart_button` |
| height | `42px` | там же |
| line-height | `15.6px` | там же |
| padding (все четыре) | `0px` | там же |
| border-top-width | `0px` | там же |
| border-radius | `0px` | там же |
| background-color | `rgb(126, 191, 154)` | там же |
| color | `rgb(255, 255, 255)` | там же |
| font-size | `13px` | там же |
| font-weight | `600` | там же |
| text-transform | `uppercase` | там же |
| letter-spacing | `normal` | там же |
| box-shadow | `rgba(0, 0, 0, 0.15) 0px -2px 0px 0px inset` | там же |
| ширина × высота | `250.1640625px` × `42px` | там же, `getBoundingClientRect()` |

---

## 5. Шапка сайта

Шапка — `header.whb-header`, оформление несёт строка `.whb-row.whb-general-header`.

| Свойство | Значение как вернул браузер | Где снято |
| --- | --- | --- |
| height | `106px` | страница товара, `.whb-row.whb-general-header` |
| min-height | `0px` | там же |
| ширина × высота по замеру | `1440px` × `106px` | там же, `getBoundingClientRect()` |
| background-color | `rgb(0, 0, 0)` | там же |
| border-bottom-width | `2px` | там же |
| border-bottom-style | `solid` | там же |
| border-bottom-color | `rgb(126, 191, 154)` | там же |
| box-shadow | `none` | там же |
| padding-top / bottom | `0px` / `0px` | там же |
| background-color внешнего `header` | `rgba(0, 0, 0, 0)` | `/`, `header.whb-header` |
| padding-top внешнего `header` | `106px` | `/`, `header.whb-header` |

Пункты меню верхнего уровня (`ul#menu-menu-lithuanian > li.item-level-0 > a`):

| Свойство | Значение как вернул браузер | Где снято |
| --- | --- | --- |
| font-family | `Rajdhani, Arial, Helvetica, sans-serif` | `/`, обычный пункт меню |
| font-size | `17px` | там же |
| font-weight | `600` | там же |
| line-height | `23.8px` | там же |
| letter-spacing | `normal` | там же |
| text-transform | `uppercase` | там же |
| color в покое | `rgb(255, 255, 255)` | там же |
| background-color | `rgba(0, 0, 0, 0)` | там же |
| border-radius | `0px` | там же |
| padding-top / bottom | `5px` / `5px` | там же |
| padding-left / right | `0px` / `0px` | там же |
| color при наведении | `rgba(255, 255, 255, 0.7)` | `/`, пункт «Kontaktai», `:hover` наведён мышью |

Признак выбранного пункта:

| Свойство | Значение как вернул браузер | Где снято |
| --- | --- | --- |
| класс на `li` | `current-menu-item current_page_item` | `/kontaktai/`, пункт «Kontaktai» |
| color выбранного пункта | `rgba(255, 255, 255, 0.7)` | там же |
| color невыбранных пунктов на той же странице | `rgb(255, 255, 255)` | `/kontaktai/`, пункты «Kraikas», «Pašarai», «Naudojamos žaliavos» |
| font-weight выбранного | `600` — как у невыбранных | `/kontaktai/` |
| background-color выбранного | `rgba(0, 0, 0, 0)` — как у невыбранных | `/kontaktai/` |
| подчёркивание / рамка у выбранного | не найдено: `text-decoration-line: none`, `border-*-width: 0px` | `/kontaktai/` |
| color выбранного в выдвижном меню (`.wd-nav-mobile`) | `rgb(126, 191, 154)` | `/`, второй набор пунктов |

Прочее в шапке:

| Свойство | Значение как вернул браузер | Где снято |
| --- | --- | --- |
| color значков (поиск, корзина) | `rgb(255, 255, 255)` | страница товара, `.wd-tools-icon` |
| счётчик корзины: font-family | `Barlow, Arial, Helvetica, sans-serif` | страница товара, `.wd-cart-number` |
| счётчик корзины: font-size | `9px` | там же |
| счётчик корзины: font-weight | `400` | там же |
| счётчик корзины: color | `rgb(255, 255, 255)` | там же |
| логотип: max-width | `150px` | страница товара, `.wd-logo img` |
| логотип: max-height | `104px` | там же |
| логотип: height | `30px` | там же |
| логотип: файл | `https://nordicpet.lt/wp-content/uploads/2021/11/NORDIC20PET20logo.png`, 1920 × 931 | там же |

---

## 6. Тёмные участки

| Свойство | Значение как вернул браузер | Где снято |
| --- | --- | --- |
| background-color строки шапки | `rgb(0, 0, 0)` | все четыре страницы, `.whb-row.whb-general-header` |
| color пунктов меню на ней | `rgb(255, 255, 255)` | там же |
| background-color первого экрана | `rgb(0, 0, 0)` | `/`, `.elementor-element-d5b86c1` |
| background-image первого экрана | `none` | там же |
| padding-bottom первого экрана | `60px` | там же |
| ширина × высота первого экрана | `1439.9921875px` × `900px` | там же, `getBoundingClientRect()` |
| color заголовка на нём | `rgb(255, 255, 255)` | `/`, `h3.elementor-heading-title` |
| background-color плашки заголовка страницы | `rgb(0, 0, 0)` | `/kontaktai/`, `.wd-page-title` |
| color этой плашки | `rgba(255, 255, 255, 0.8)` | там же |
| padding-top / bottom плашки | `20px` / `20px` | там же |
| color заголовка `h1` на ней | `rgb(255, 255, 255)` | `/kontaktai/`, `h1.entry-title.title` |
| background-color полноэкранного поиска | `rgb(15, 15, 15)` | `/kontaktai/`, `.wd-search-full-screen` |
| color в нём | `rgba(255, 255, 255, 0.8)` | там же |
| background-color затемнения под боковыми панелями | `rgba(0, 0, 0, 0.7)` | `/kontaktai/`, `.wd-close-side` |

Подвал тёмным **не является**:

| Свойство | Значение как вернул браузер | Где снято |
| --- | --- | --- |
| background-color | `rgb(255, 255, 255)` | `/parduotuve/` и страница товара, `footer.wd-footer` |
| background-image | `none` | там же |
| color | `rgb(118, 118, 118)` | там же |
| высота | `331px` | `/parduotuve/`, `getBoundingClientRect()` |
| background-color всех трёх полос внутри подвала | `rgba(0, 0, 0, 0)` | страница товара, `.elementor-8040 > .e-con` |
| color строки копирайта | `rgb(206, 203, 203)` | страница товара, `.elementor-element-9040fc3 p` |
| padding-top / bottom полосы копирайта | `10px` / `10px` | страница товара, `.elementor-element-f95ac42 .e-con-inner` |

---

## 7. Ширина содержимого

| Свойство | Значение как вернул браузер | Где снято |
| --- | --- | --- |
| max-width | `1222px` | `/`, `/parduotuve/`, страница товара — `.container` |
| width по замеру при окне 1440 | `1222px` | `/parduotuve/`, `getBoundingClientRect()` |
| x левого края при окне 1440 | `109px` | там же |
| padding-left / right | `15px` / `15px` | там же |
| margin-left / right | `auto` / `auto` | `/`, `.container` вне вложенных блоков |
| max-width колонки Elementor | `1200px` | `/`, `.e-con.e-parent > .e-con-inner` |
| width этой колонки по замеру | `1192px` | там же |
| padding-left / right этой колонки | `0px` / `0px` | там же |
| width наружного блока Elementor | `1439.99px` | `/`, `.e-con.e-parent` |
| max-width наружного блока | `100%` | там же |
| width области содержимого магазина | `886.5px` (при колонке фильтров слева) | `/parduotuve/`, `.wd-content-area.site-content` |
| max-width этой области | `none` | там же |

---

## Снимки экрана

| Файл | Что на нём |
| --- | --- |
| `nordicpet-home.png` | главная страница https://nordicpet.lt/ , окно 1440 × 900, окно о печеньях уже отклонено |
| `nordicpet-product.png` | страница товара https://nordicpet.lt/produktas/susokantis-medzio-kraikas-katems-prenumerata/ , окно 1440 × 900, окно о печеньях уже отклонено |

Оба лежат в этой же папке. Сняты отдельным запуском браузера в безголовом режиме через
протокол отладки: в нём кнопка «Atmesti» нажималась тем же способом, страница снималась после
этого. Размер каждого снимка — один экран 1440 × 900, не вся страница целиком.

---

## Чего снять не удалось и почему

| Что | Почему |
| --- | --- |
| Правила `:hover` из таблиц стилей | `document.styleSheets` вернул 74 таблицы, но всего 105 правил и ни одного с `:hover`; внешние файлы в этом окружении отдают пустой список правил, а не ошибку доступа. Поэтому все состояния при наведении сняты не чтением правил, а живым наведением указателя и последующим `getComputedStyle`. |
| Состояние при наведении для карточки товара, её кнопки и пунктов подменю | Не наводил: указатель наводился только на четыре элемента — пункт меню «Kontaktai», жёлтую кнопку шапки, обе кнопки первого экрана и ссылку подвала. Остальное осталось только в покое. |
| Отрисованный размер логотипа в пикселях | Изображение логотипа на всех заходах оставалось отложенной заглушкой (`data:image/svg+xml,…`), `getBoundingClientRect().width` возвращал `0`. Сняты только `max-width: 150px`, `max-height: 104px`, `height: 30px` и адрес файла. |
| Цвет ссылки внутри абзаца основного текста | Таких ссылок на осмотренных страницах не нашлось: все найденные ссылки — пункты меню, названия товаров и список ссылок подвала. Цвет ссылки снят с ссылки подвала. |
| Признак выбранного пункта для «EL. PARDUOTUVĖ» | Ни на одной из четырёх страниц этот пункт не получал класс `current-menu-item`, в том числе на `/parduotuve/`. Сравнить выбранное и невыбранное состояние для жёлтой кнопки не на чем. |
| Хлебные крошки на странице товара | Селекторы `.woocommerce-breadcrumb` и `.wd-breadcrumbs` вернули `null`. |
| Состояние `:focus` у кнопок и полей | Не снималось: фокус ставится щелчком или клавишей, а формы и кнопки на сайте трогать нельзя. |

---

## Наши выводы

Всё в этом разделе — наш вывод, а не свойство, возвращённое браузером.

| Наш вывод | На чём основан |
| --- | --- |
| Сайт собран на WordPress с темой Woodmart, конструктором Elementor и WooCommerce. | Имена классов `whb-header`, `wd-nav`, `woodmart-nav-link`, `elementor-element`, `product-grid-item`, переменные `--wd-*`, путь `/wp-content/uploads/`. |
| Единой шкалы кеглей у сайта нет. | На четырёх страницах встретились кегли 9, 12, 13, 14, 16, 17, 18, 22, 24, 34, 41, 44, 65 px; заголовок одного уровня меняет и кегль, и семейство от страницы к странице. |
| Единого шрифта заголовков тоже нет: в дело идут пять семейств. | `Barlow`, `Rajdhani`, `Exo 2`, `Oswald`, `Abel` — все пять встретились в заголовках и тексте, при том что переменная темы `--wd-title-font` объявляет только `Barlow`. |
| Фирменный зелёный дашборда стоит брать как `rgb(126, 191, 154)`. | Это значение переменной `--wd-primary-color` и оно же встречается в шести разных местах: рамка шапки, три кнопки, две цены. |
| Зелёный в самом логотипе — другой, чем фирменный зелёный темы. | Наш замер: скачали файл логотипа, нарисовали на холсте и посчитали непрозрачные пиксели. Самый частый цвет — `rgb(85,184,137)`, 35 239 пикселей; следующие пять — `rgb(85,184,139)`, `rgb(87,183,137)`, `rgb(87,183,139)`, `rgb(85,184,135)`, `rgb(86,185,140)`. Это наш подсчёт по картинке, а не свойство CSS. |
| Жёлтая кнопка шапки и переменная темы `--wd-alternative-color` — не одно и то же значение. | Браузер вернул фон кнопки `rgb(255, 187, 54)`, а переменная объявлена как `#fbbc34`, то есть `rgb(251, 188, 52)`. |
| Выбранный пункт меню на сайте помечен ослаблением, а не усилением. | Выбранный — `rgba(255, 255, 255, 0.7)`, невыбранный — `rgb(255, 255, 255)`; насыщенность, фон, рамка и подчёркивание у них одинаковые. То же значение даёт и наведение, то есть выбранный пункт выглядит как пункт под указателем. |
| Тёмного подвала у сайта нет, брать оттуда пару «тёмный фон / светлый текст» не с чего. | Подвал белый (`rgb(255, 255, 255)`), все полосы внутри прозрачны, а текст копирайта — `rgb(206, 203, 203)`. Тёмные участки на сайте только два: полоса шапки и первый экран главной. |
| Строка копирайта на сайте читается плохо. | Наш вывод из двух снятых значений: текст `rgb(206, 203, 203)` на фоне `rgb(255, 255, 255)`. Числа контраста мы не считали. |
| Ширина колонки: 1222 px внешне, 1192 px под содержимое, поля по 109 px при окне 1440. | `max-width: 1222px` и `padding: 15px` по бокам у `.container`; 1222 − 15 − 15 = 1192 — это наш подсчёт. Поле 109 px снято замером `x` левого края при окне 1440. |
| Скругление на сайте живёт только в круглых кнопках, остальное — прямые углы. | `border-radius: 20px` у трёх кнопок (жёлтая в шапке и обе на первом экране) и `0px` у карточки, её обёртки, обеих кнопок «в корзину» и у переменной темы `--wd-form-brd-radius`. |
| Тени как приём оформления сайт почти не использует. | `box-shadow: none` у шапки, карточки, её обёртки и всех кнопок первого экрана; единственная найденная тень — внутренняя подсветка снизу у кнопок «в корзину»: `rgba(0, 0, 0, 0.15) 0px -2px 0px 0px inset`. |
| Карточка товара держится на рамке, а не на фоне или тени. | Фон у карточки и обёртки прозрачный, тени нет, а у обёртки рамка `1px solid rgba(0, 0, 0, 0.106)` по всем четырём сторонам. |
