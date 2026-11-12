// Tipos de la base (formato de `supabase gen types`).
// El generador del MCP solo emite el esquema public, así que `produccion` se escribe a mano
// desde supabase/migrations/ (001–009). Al cambiar una migración, actualizar acá.

import type { OperariaEnOrden, Participacion } from '../domain/participaciones'

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

type Ts = string // timestamptz en ISO
type Uuid = string

type EstadoFabricacion = 'cola' | 'fabricando' | 'pausada' | 'para_envasar' | 'finalizada' | 'cancelada'
type EstadoTarea = 'cola' | 'activo' | 'pausado' | 'finalizado' | 'cancelado'
type EntidadEvento = 'fabricacion' | 'envasado' | 'fraccionado'
export type TipoProducto = 'liquido' | 'denso' | 'polvo'

// Row completo; Insert hace opcionales las columnas con default.
type Tabla<Row, Opcionales extends keyof Row, Requeridas extends keyof Row = Exclude<keyof Row, Opcionales>> = {
  Row: Row
  Insert: Pick<Row, Requeridas> & Partial<Pick<Row, Opcionales>>
  Update: Partial<Row>
  Relationships: []
}

type Vista<Row> = { Row: Row; Relationships: [] }

// Relaciones (FK) que el cliente usa en embeds de PostgREST, p. ej. envasados → presentaciones.
type ConRelaciones<T, R> = Omit<T, 'Relationships'> & { Relationships: R }

export type Database = {
  __InternalSupabase: { PostgrestVersion: '14.5' }
  public: {
    Tables: {
      perfiles: Tabla<
        {
          activo: boolean
          created_at: Ts
          email: string | null
          equipo_id: string | null
          id: Uuid
          nombre: string | null
          rol: string
          rol_mantenimiento: string | null
          rol_produccion: 'panel' | 'planta' | null
          updated_at: Ts
        },
        'activo' | 'created_at' | 'email' | 'equipo_id' | 'nombre' | 'rol' | 'rol_mantenimiento' | 'rol_produccion' | 'updated_at'
      >
    }
    Views: { [_ in never]: never }
    Functions: { [_ in never]: never }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
  // Solo lo que ProdControl lee de core (expuesto en la API; select abierto a authenticated).
  core: {
    Tables: {
      funcionarios: {
        Row: { id: Uuid; nombre: string; foto_url: string | null; sector: string; estado: string }
        Insert: never
        Update: never
        Relationships: []
      }
    }
    Views: { [_ in never]: never }
    Functions: { [_ in never]: never }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
  produccion: {
    Tables: {
      productos: Tabla<
        {
          id: Uuid
          nombre: string
          codigo: string | null
          color: string
          tipo: TipoProducto
          litros_hora_std: number | null
          activo: boolean
          created_at: Ts
        },
        'id' | 'codigo' | 'color' | 'tipo' | 'litros_hora_std' | 'activo' | 'created_at'
      >
      presentaciones: Tabla<
        { id: Uuid; nombre: string; litros_equiv: number; activo: boolean },
        'id' | 'activo'
      >
      tanques: Tabla<
        { id: Uuid; codigo: string; capacidad_l: number; orden: number; activo: boolean },
        'id' | 'orden' | 'activo'
      >
      // pin_hash / pin_intentos / pin_bloqueado_hasta no son legibles por authenticated
      operarias: Tabla<
        { empleado_id: Uuid; categoria: string | null; color_avatar: string | null; activo: boolean },
        'categoria' | 'color_avatar' | 'activo'
      >
      fabricaciones: Tabla<
        {
          id: Uuid
          tanque_id: Uuid
          producto_id: Uuid
          litros: number
          lote: string | null
          vencimiento: string | null
          fecha_formula: string | null
          estado: EstadoFabricacion
          operaria_id: Uuid | null
          inicio: Ts | null
          fin: Ts | null
          creado_por: Uuid | null
          created_at: Ts
        },
        | 'id'
        | 'lote'
        | 'vencimiento'
        | 'fecha_formula'
        | 'estado'
        | 'operaria_id'
        | 'inicio'
        | 'fin'
        | 'creado_por'
        | 'created_at'
      >
      fabricacion_mp: Tabla<
        {
          id: Uuid
          fabricacion_id: Uuid
          orden: number
          codigo: string
          descripcion: string
          cantidad: number
          lote: string | null
          pesado: boolean
          cargado_por: Uuid | null
          cargado_at: Ts | null
        },
        'id' | 'lote' | 'pesado' | 'cargado_por' | 'cargado_at'
      >
      envasados: ConRelaciones<
        Tabla<
        {
          id: Uuid
          fabricacion_id: Uuid
          presentacion_id: Uuid
          cantidad: number
          etiquetado: string | null
          etiqueta_id: Uuid | null
          operaria_1: Uuid | null
          operaria_2: Uuid | null
          estado: EstadoTarea
          inicio: Ts | null
          fin: Ts | null
          creado_por: Uuid | null
          created_at: Ts
        },
        'id' | 'etiquetado' | 'etiqueta_id' | 'operaria_1' | 'operaria_2' | 'estado' | 'inicio' | 'fin' | 'creado_por' | 'created_at'
        >,
        [
          {
            foreignKeyName: 'envasados_presentacion_id_fkey'
            columns: ['presentacion_id']
            isOneToOne: false
            referencedRelation: 'presentaciones'
            referencedColumns: ['id']
          },
        ]
      >
      fraccionados: Tabla<
        {
          id: Uuid
          tipo: string
          descripcion: string | null
          producto_id: Uuid | null
          presentacion_id: Uuid | null
          cantidad: number
          lote: string | null
          etiquetado: string | null
          etiqueta_id: Uuid | null
          operaria_id: Uuid | null
          estado: EstadoTarea
          inicio: Ts | null
          fin: Ts | null
          creado_por: Uuid | null
          created_at: Ts
        },
        | 'id'
        | 'descripcion'
        | 'producto_id'
        | 'presentacion_id'
        | 'lote'
        | 'etiquetado'
        | 'etiqueta_id'
        | 'operaria_id'
        | 'estado'
        | 'inicio'
        | 'fin'
        | 'creado_por'
        | 'created_at'
      >
      participaciones: Tabla<
        {
          id: Uuid
          entidad: EntidadEvento
          entidad_id: Uuid
          empleado_id: Uuid
          desde: Ts
          hasta: Ts | null
          cantidad: number | null
          unidad: 'L' | 'kg' | null
          cantidad_corregida: number | null
          corregida_por: Uuid | null
          corregida_at: Ts | null
        },
        'id' | 'desde' | 'hasta' | 'cantidad' | 'unidad' | 'cantidad_corregida' | 'corregida_por' | 'corregida_at'
      >
      etiquetas: Tabla<
        {
          id: Uuid
          nombre: string
          activo: boolean
          created_at: Ts
        },
        'id' | 'activo' | 'created_at'
      >
      eventos: Tabla<
        {
          id: number
          entidad: EntidadEvento
          entidad_id: Uuid
          accion: 'crear' | 'iniciar' | 'sumarse' | 'salir' | 'pausar' | 'reanudar' | 'finalizar' | 'cancelar' | 'editar'
          empleado_id: Uuid | null
          usuario_id: Uuid | null
          dispositivo: string | null
          at: Ts
          datos: Json
        },
        'id' | 'empleado_id' | 'usuario_id' | 'dispositivo' | 'at' | 'datos'
      >
      alertas: Tabla<
        {
          id: Uuid
          tipo: 'exceso_9h' | 'desvio_estandar' | 'pausa_larga' | 'falta_envasado'
          entidad: EntidadEvento | null
          entidad_id: Uuid | null
          texto: string
          creada: Ts
          leida: boolean
          pospuesta_hasta: Ts | null
        },
        'id' | 'entidad' | 'entidad_id' | 'creada' | 'leida' | 'pospuesta_hasta'
      >
    }
    Views: {
      v_operarias: Vista<{
        empleado_id: Uuid
        nombre: string
        foto_url: string | null
        categoria: string | null
        color_avatar: string | null
        activo: boolean
      }>
      v_tanque_estado: Vista<{
        tanque_id: Uuid
        codigo: string
        capacidad_l: number
        orden: number
        estado: 'libre' | 'cola' | 'fabricando' | 'pausada' | 'para_envasar' | 'cola_env' | 'envasando' | 'env_pausado'
        fabricacion_id: Uuid | null
        producto_id: Uuid | null
        producto: string | null
        color: string | null
        litros: number | null
        litros_restantes: number | null
        envasado_id: Uuid | null
        operaria_id: Uuid | null
        inicio: Ts | null
        producto_tipo: TipoProducto | null
      }>
      v_flujo: Vista<{
        entidad: EntidadEvento
        id: Uuid
        estado: EstadoFabricacion | EstadoTarea
        producto: string | null
        color: string | null
        tanque_codigo: string | null
        presentacion: string | null
        cantidad: number | null
        litros: number | null
        lote: string | null
        descripcion: string | null
        operaria_1: Uuid | null
        operaria_2: Uuid | null
        listo: boolean
        inicio: Ts | null
        min_efectivos: number | null
        corriendo: boolean
        created_at: Ts
        fin: Ts | null
        fabricacion_id: Uuid | null
        litros_restantes: number | null
        producto_tipo: TipoProducto | null
        operarias: OperariaEnOrden[]
        etiqueta: string | null
      }>
      v_tareas: Vista<{
        entidad: EntidadEvento
        id: Uuid
        estado: EstadoFabricacion | EstadoTarea
        producto: string | null
        color: string | null
        tanque_codigo: string | null
        presentacion: string | null
        cantidad: number | null
        litros: number | null
        lote: string | null
        descripcion: string | null
        operaria_1: Uuid | null
        operaria_2: Uuid | null
        listo: boolean
        inicio: Ts | null
        min_efectivos: number | null
        corriendo: boolean
        created_at: Ts
        mp_total: number
        mp_completas: number
        producto_tipo: TipoProducto | null
        operarias: OperariaEnOrden[]
        etiqueta: string | null
        vencimiento: string | null
      }>
      v_historial: Vista<{
        entidad: EntidadEvento
        id: Uuid
        estado: EstadoFabricacion | EstadoTarea
        producto: string | null
        color: string | null
        tanque_codigo: string | null
        presentacion: string | null
        cantidad: number | null
        litros: number | null
        litros_equiv: number | null
        lote: string | null
        descripcion: string | null
        operaria_1: Uuid | null
        operaria_1_nombre: string | null
        operaria_2: Uuid | null
        operaria_2_nombre: string | null
        inicio: Ts | null
        fin: Ts | null
        created_at: Ts
        min_brutos: number | null
        min_pausa: number | null
        min_efectivos: number | null
        dia: string
        participaciones: Participacion[]
        etiqueta: string | null
      }>
      v_tiempos_estandar: Vista<{
        entidad: 'fabricacion' | 'envasado'
        clave: string
        velocidad: number
        muestras: number
        litros_hora_std: number | null
      }>
      v_tiempos_efectivos: Vista<{
        entidad: EntidadEvento
        entidad_id: Uuid
        inicio: Ts
        fin: Ts | null
        min_brutos: number
        min_pausa: number
        min_efectivos: number
      }>
    }
    Functions: {
      accion: {
        Args: {
          p_entidad: EntidadEvento
          p_id: Uuid
          p_accion: 'iniciar' | 'sumarse' | 'salir' | 'pausar' | 'reanudar' | 'finalizar' | 'cancelar'
          p_empleado_id?: Uuid
          p_pin?: string
          p_cantidades?: { empleado_id: Uuid; cantidad: number; unidad: 'L' | 'kg' }[]
        }
        Returns: Json
      }
      corregir_cantidad: {
        Args: { p_participacion_id: Uuid; p_cantidad: number; p_unidad?: 'L' | 'kg' }
        Returns: Json
      }
      set_vencimiento: {
        Args: { p_fab_id: Uuid; p_fecha: string; p_empleado_id?: Uuid }
        Returns: Json
      }
      set_pin: { Args: { p_empleado_id: Uuid; p_pin: string }; Returns: undefined }
      verificar_pin: { Args: { p_empleado_id: Uuid; p_pin: string }; Returns: Json }
      crear_fabricacion_formula: {
        Args: {
          p_fab: {
            tanque_id: Uuid
            producto_id: Uuid
            litros: number
            lote: string
            vencimiento: string
            fecha_formula: string
            operaria_id: Uuid | null
            codigo_producto: string
          }
          p_mp: { codigo: string; descripcion: string; cantidad: number }[]
        }
        Returns: Json
      }
      cargar_mp: {
        Args: {
          p_mp_id: Uuid
          p_lote: string
          p_pesado: boolean
          p_empleado_id?: Uuid
          p_pin?: string
        }
        Returns: Json
      }
      listar_usuarios: {
        Args: never
        Returns: {
          id: Uuid
          email: string | null
          nombre: string | null
          rol: string
          rol_produccion: 'panel' | 'planta' | null
          activo: boolean
        }[]
      }
      set_rol_usuario: { Args: { p_usuario: Uuid; p_rol: 'panel' | 'planta' | null }; Returns: undefined }
      es_panel: { Args: never; Returns: boolean }
      es_planta: { Args: never; Returns: boolean }
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}
