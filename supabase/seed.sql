-- Демонстрационные строки.
--
-- Файл выполняется только при локальном пересоздании базы и никогда не уезжает в облачный
-- проект вместе с миграциями: в облаке этого кода просто не существует, и запирать нечего.
--
-- Наполняется только сырой слой, и только функциями записи снимка. Две причины.
-- Первая: механизм идемпотентности в проекте один, и держать его в двух местах разными
-- способами значило бы однажды разойтись молча. Вторая: слой фактов остаётся пустым намеренно.
-- Цепочка «источник → сырьё → факты» ни одного шага не перепрыгивает, а разбора в S1 нет —
-- значит выводить факты некому, и вписанные руками факты были бы неотличимы от настоящих.
--
-- Строки повторяют кривизну источника нарочно: обе формы даты, три написания артикула,
-- сумма по-европейски с неразрывным пробелом, две выгрузки meta с совпадающим содержимым.

select raw.replace_orders($json$[
  {"row_no": 1, "date": "01.03.2026", "order_id": "A-1001", "sku": "NP-001", "units": "1",
   "gross_eur": "24,90", "discount_eur": "", "gateway": "stripe"},
  {"row_no": 2, "date": "2026-03-01", "order_id": "A-1002", "sku": "np-003 ", "units": "2",
   "gross_eur": "51,80", "discount_eur": "5,00", "gateway": "paypal"},
  {"row_no": 3, "date": "02.03.2026", "order_id": "A-1003", "sku": "NP‑003", "units": "1",
   "gross_eur": "25,90", "discount_eur": "", "gateway": "stripe"},
  {"row_no": 4, "date": "2026-03-03", "order_id": "A-1004", "sku": "NP-002", "units": "3",
   "gross_eur": "89,70", "discount_eur": "", "gateway": "stripe"}
]$json$::jsonb);

select raw.replace_refunds($json$[
  {"row_no": 1, "refund_date": "05.03.2026", "order_id": "A-1001", "sku": "NP-001",
   "units": "1", "amount_eur": "24,90"},
  {"row_no": 2, "refund_date": "2026-03-06", "order_id": "A-1002", "sku": "np-003 ",
   "units": "1", "amount_eur": "25,90"}
]$json$::jsonb);

select raw.replace_costs($json$[
  {"row_no": 1, "sku": "NP-001", "cost_eur": "9,10", "valid_from": "01.01.2026"},
  {"row_no": 2, "sku": "NP-002", "cost_eur": "31,00", "valid_from": "2026-01-01"},
  {"row_no": 3, "sku": "NP‑003", "cost_eur": "", "valid_from": "01.02.2026"}
]$json$::jsonb);

select raw.replace_fees($json$[
  {"row_no": 1, "gateway": "stripe", "percent": "1,4", "fixed_eur": "0,25"},
  {"row_no": 2, "gateway": "paypal", "percent": "2,49", "fixed_eur": "0,35"}
]$json$::jsonb);

select raw.replace_opex($json$[
  {"row_no": 1, "month": "2026-03", "category": "аренда", "amount_eur": "1 234,50"},
  {"row_no": 2, "month": "03.2026", "category": "связь", "amount_eur": "89,00"},
  {"row_no": 3, "month": "2026-03", "category": "бухгалтерия", "amount_eur": ""}
]$json$::jsonb);

select raw.replace_fx($json$[
  {"row_no": 1, "date": "01.03.2026", "usd_per_eur": "1,0850"},
  {"row_no": 2, "date": "2026-03-02", "usd_per_eur": "1,0871"},
  {"row_no": 3, "date": "03.03.2026", "usd_per_eur": "1,0902"}
]$json$::jsonb);

-- Папка целиком, все файлы разом. Два файла meta совпадают содержимым построчно и различаются
-- только именем: на этом S3 будет опознавать дубликат, и сырой слой обязан довезти оба.
select raw.replace_entire_ads_folder($json$[
  {"file_name": "meta_2026-03.csv", "row_no": 1, "date": "2026-03-01", "campaign": "spring",
   "spend_usd": "12.40"},
  {"file_name": "meta_2026-03.csv", "row_no": 2, "date": "2026-03-02", "campaign": "spring",
   "spend_usd": "9.80"},
  {"file_name": "meta_2026-03 (1).csv", "row_no": 1, "date": "2026-03-01", "campaign": "spring",
   "spend_usd": "12.40"},
  {"file_name": "meta_2026-03 (1).csv", "row_no": 2, "date": "2026-03-02", "campaign": "spring",
   "spend_usd": "9.80"},
  {"file_name": "google_2026-03.csv", "row_no": 1, "date": "2026-03-01", "campaign": "search",
   "spend_usd": "31.00"},
  {"file_name": "pinterest_2026-03.csv", "row_no": 1, "date": "2026-03-02", "campaign": "pins",
   "spend_usd": "4.20"}
]$json$::jsonb);
