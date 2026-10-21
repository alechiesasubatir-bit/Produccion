-- ProdControl · 009 — alertas automáticas cada 10 minutos (pg_cron, OK del usuario 2026-10-21)
create extension if not exists pg_cron;

select cron.schedule('produccion-revisar-alertas', '*/10 * * * *', 'select produccion.revisar_alertas()');
