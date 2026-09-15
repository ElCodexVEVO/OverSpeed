# OverSpeed

Sistema de gestión para el taller **OverSpeed Performance**: punto de venta,
órdenes de trabajo, clientes, inventario, comisiones y estadísticas.

Aplicación de una sola página, sin framework ni proceso de compilación. Se sirve
como archivos estáticos y guarda los datos en Supabase.

---

## Qué incluye

| Módulo | Qué hace |
|---|---|
| Dashboard | Órdenes activas, vehículos atendidos, clientes e ingresos del mes; ingresos de los últimos 30 días y reparto por estado |
| TPV / Nueva venta | Catálogo por categorías con coste y precio, ticket editable, convenios y cálculo de comisión |
| Órdenes de trabajo | Historial con filtros por texto, fechas y estado; ver, editar, anular, borrar y exportar a CSV |
| Clientes | Vehículos por matrícula, último cliente, trabajos activos y facturación acumulada |
| Inventario / Piezas | Alta y edición de piezas y servicios, y gestión de convenios con logotipo |
| Empleados | Alta y baja de cuentas, perfiles, rol, comisión y auditoría |
| Estadísticas | Facturación por día, ranking de servicios y rendimiento por empleado |
| Pagos | Comisiones pendientes por empleado y registro de cortes |
| Ajustes | Cuenta, estado de la conexión, recuento de datos cargados y exportación |

## Cómo funciona

- **Sin backend propio.** Toda la lógica sensible vive en funciones
  `security definer` de PostgreSQL. El navegador nunca escribe directamente en
  las tablas: llama a `os_submit_order`, `os_void_order`, `os_pay_employee`,
  `os_manage` y compañía.
- **Row Level Security en todas las tablas.** Un mecánico solo lee sus propias
  órdenes y sus propios pagos; el administrador lo ve todo. Ocultar un botón en
  la interfaz no es la barrera: la barrera está en la base de datos.
- **Dos roles**, `admin` y `employee`. El esquema impide que alguien se quite su
  propio rol o que quede el taller sin ningún administrador activo.
- **Cálculo compartido.** `core.js` concentra totales, descuentos, comisiones y
  validaciones, y se usa tanto en la interfaz como en el modo demo.

## Modo demo

Abriendo la aplicación con `#demo` al final de la dirección
(`.../index.html#demo`) arranca con datos de ejemplo guardados en
`localStorage`, sin tocar Supabase. Reproduce las validaciones de las funciones
SQL, así que sirve para enseñar el sistema o para desarrollar sin credenciales.
Desde la banda superior se alterna entre administrador y empleado y se
restablecen los datos.

No hay ningún botón de demo en la pantalla de acceso: es una herramienta
interna, no una opción para el personal del taller.

## Instalación

Consulta [INSTALAR.md](INSTALAR.md). En resumen: crear el proyecto de Supabase,
ejecutar `supabase/schema.sql`, aplicar las migraciones en orden, crear el primer
administrador y servir la carpeta.

## Estructura

```
index.html            Marcado de la aplicación y de la pantalla de acceso
styles.css            Identidad visual (negro y rojo) y todos los componentes
app.js                Lógica: sesión, datos, modo demo y las ocho vistas
core.js               Cálculo y validaciones; sin dependencias del DOM
shell.js              Menú lateral en móvil y eslogan por vista (sin lógica de datos)
catalog.js            Catálogo de respaldo para el modo demo
config.js             URL y clave pública de Supabase (opcional)
assets/               Iconos
supabase/
  schema.sql          Esquema base: tablas, RLS y funciones
  migrations/         Cambios posteriores, en orden
```

## Migraciones

Se ejecutan en el SQL Editor de Supabase, en orden y después de `schema.sql`.
Todas son idempotentes.

| Archivo | Cambio |
|---|---|
| `001_convenios_logo.sql` | Añade `logo_url` a `os_discounts` y permite guardarlo desde `os_manage` |
| `002_vehiculo_opcional.sql` | El modelo del vehículo deja de ser obligatorio en `os_submit_order` y `os_edit_order` |
| `003_borrar_orden.sql` | Añade `os_delete_order`, que borra órdenes ya anuladas dejando copia en auditoría |
| `004_alta_empleados.sql` | Añade la acción `profile_create` a `os_manage` para dar de alta empleados desde la aplicación |
| `005_eliminar_empleado.sql` | Añade `os_delete_profile`, que elimina empleados sin historial y libera su usuario |
| `006_autoconfirmar_cuentas.sql` | Opcional. Marca como confirmadas las cuentas nuevas, sin depender del ajuste del panel |

## Personalización

- **Logotipo.** La marca se dibuja con tipografía. Para usar una imagen propia,
  sustituye el bloque `.wordmark` de `index.html` por un `<img>`; hay un
  comentario en el sitio exacto.
- **Fotografía de acceso.** Deja un archivo en `assets/garage.jpg` y descomenta
  la línea indicada en `.gate-visual`, dentro de `styles.css`.
- **Colores.** Todo sale de las variables CSS declaradas en `:root`.
- **Dominio de los usuarios.** El acceso es por nombre de usuario; la
  constante `USER_DOMAIN` de `app.js` define el dominio interno que se le
  añade por detrás para Supabase.

## Seguridad

En el navegador solo se usa la clave pública (`anon` / `publishable`). La clave
de servicio no aparece en ningún archivo de este repositorio y no debe hacerlo
nunca: expondría la base de datos entera saltándose RLS.

## Licencia

Uso interno de OverSpeed Performance.
