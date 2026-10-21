-- Va justo después de `select plan(n)`: permite a authenticated escribir en las tablas
-- temporales de pgTAP y en _tap cuando el test hace `set local role authenticated`.
do $$ declare r record; begin
  for r in select relname from pg_class where relnamespace = pg_my_temp_schema() and relkind in ('r', 'S') loop
    execute format('grant all on pg_temp.%I to public', r.relname);
  end loop;
end $$;
