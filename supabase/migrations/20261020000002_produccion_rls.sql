-- ProdControl · 002 — helpers de rol, grants, RLS y v_operarias

-- Helpers de rol ------------------------------------------------------------
-- panel  = encargada/admin: perfiles.rol = 'admin' o rol_produccion = 'panel'
-- planta = usuario-dispositivo (tablet): rol_produccion = 'planta'
create function produccion.es_panel() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.perfiles p
    where p.id = auth.uid() and p.activo
      and (p.rol = 'admin' or p.rol_produccion = 'panel')
  );
$$;

create function produccion.es_planta() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.perfiles p
    where p.id = auth.uid() and p.activo and p.rol_produccion = 'planta'
  );
$$;

revoke execute on function produccion.es_panel(), produccion.es_planta() from public, anon;
grant execute on function produccion.es_panel(), produccion.es_planta() to authenticated;

-- Grants (RLS filtra filas; los grants filtran tablas y columnas) ----------
grant select, insert, update, delete on
  produccion.productos, produccion.presentaciones, produccion.tanques,
  produccion.fabricaciones, produccion.envasados, produccion.fraccionados,
  produccion.alertas
  to authenticated;
grant select on produccion.eventos to authenticated;
-- operarias: nunca pin_hash / pin_intentos / pin_bloqueado_hasta (eso es solo de las RPC)
grant select (empleado_id, categoria, color_avatar, activo) on produccion.operarias to authenticated;
grant insert (empleado_id, categoria, color_avatar, activo) on produccion.operarias to authenticated;
grant update (categoria, color_avatar, activo) on produccion.operarias to authenticated;
grant delete on produccion.operarias to authenticated;

-- Políticas -----------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['productos', 'presentaciones', 'tanques', 'operarias',
                           'fabricaciones', 'envasados', 'fraccionados', 'alertas'] loop
    execute format($p$
      create policy %1$s_leer on produccion.%1$I for select to authenticated
        using ((select produccion.es_panel()) or (select produccion.es_planta()));
      create policy %1$s_crear on produccion.%1$I for insert to authenticated
        with check ((select produccion.es_panel()));
      create policy %1$s_editar on produccion.%1$I for update to authenticated
        using ((select produccion.es_panel())) with check ((select produccion.es_panel()));
      create policy %1$s_borrar on produccion.%1$I for delete to authenticated
        using ((select produccion.es_panel()));
    $p$, t);
  end loop;
end $$;

-- eventos: solo lectura; se escriben únicamente desde las RPC (security definer)
create policy eventos_leer on produccion.eventos for select to authenticated
  using ((select produccion.es_panel()) or (select produccion.es_planta()));

-- v_operarias: lo que la tablet necesita para elegir operaria ----------------
create view produccion.v_operarias with (security_invoker = true) as
  select o.empleado_id, f.nombre, f.foto_url, o.categoria, o.color_avatar, o.activo
  from produccion.operarias o
  join core.funcionarios f on f.id = o.empleado_id
  where o.activo and f.estado <> 'baja';

grant select on produccion.v_operarias to authenticated;
