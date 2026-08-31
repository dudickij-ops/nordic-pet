-- Роли, которыми Supabase различает посетителя, вошедшего пользователя и служебный доступ.
-- В облачном проекте они уже есть, и здесь миграция ничего не делает.
-- Локальная база — обычный Postgres, в нём их нет; без них на S6 нечем закрыть доступ.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;

  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;

  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;
