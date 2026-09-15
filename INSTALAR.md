# Instalación de OverSpeed

Tiempo aproximado: 15 minutos. No hace falta instalar nada en el ordenador.

---

## 1. Crear el proyecto de Supabase

Entra en [supabase.com](https://supabase.com), crea un proyecto y anota la
contraseña de la base de datos. Elige la región más cercana al taller.

## 2. Ejecutar el esquema

En el panel de Supabase, ve a **SQL Editor** y pega el contenido completo de
`supabase/schema.sql`. Ejecútalo.

Esto crea las siete tablas, activa Row Level Security, define las funciones de
negocio y carga el catálogo inicial de piezas y los tres convenios de ejemplo.

## 3. Aplicar las migraciones

En el mismo SQL Editor, ejecuta **en orden** los archivos de
`supabase/migrations/`:

1. `001_convenios_logo.sql` — logotipo en los convenios
2. `002_vehiculo_opcional.sql` — el vehículo deja de ser obligatorio
3. `003_borrar_orden.sql` — borrado de órdenes anuladas
4. `004_alta_empleados.sql` — alta de empleados desde la aplicación
5. `005_eliminar_empleado.sql` — baja de empleados

La sexta es opcional:

6. `006_autoconfirmar_cuentas.sql` — alternativa al ajuste «Confirm email»

Todas son idempotentes: si las ejecutas dos veces no pasa nada.

## 4. Crear el primer administrador

Primero la cuenta, después el perfil.

1. Ve a **Authentication › Users** y pulsa **Add user**. Introduce el correo y
   una contraseña de al menos 8 caracteres. Marca la cuenta como confirmada.
2. Vuelve al **SQL Editor** y ejecuta, cambiando el correo por el tuyo:

   ```sql
   select public.os_bootstrap_admin('tu@correo.com');
   ```

Esa función solo funciona una vez: si ya existe un administrador activo, falla a
propósito. A partir de ahí los usuarios se gestionan desde la aplicación.

## 5. Obtener las credenciales públicas

En **Project Settings › API** copia:

- **Project URL** — algo como `https://abcdefgh.supabase.co`
- **anon public** (o *publishable key*)

No copies nunca la **service_role**. Esa clave salta todas las políticas de
seguridad y no debe salir del panel de Supabase.

## 6. Conectar la aplicación

Edita `config.js` y rellena los dos valores:

```js
window.OVERSPEED_CONFIG = {
  supabaseUrl: 'https://tu-proyecto.supabase.co',
  supabaseAnonKey: 'sb_publishable_...'
};
```

La pantalla de acceso no ofrece configurar la conexión desde el navegador, a
propósito: el personal del taller solo debe ver el formulario de inicio de
sesión. Si `config.js` está vacío, la aplicación avisa de que falta configurar
la conexión.

## 7. Publicar

Son archivos estáticos: sirve la carpeta con lo que prefieras.

- **GitHub Pages** — en el repositorio, *Settings › Pages*, rama `main` y
  carpeta raíz.
- **Netlify o Vercel** — arrastra la carpeta, sin configuración.
- **En local** — `python3 -m http.server 8080` y abre `http://localhost:8080`.

Abrir `index.html` haciendo doble clic también funciona para probar el modo
demo (`index.html#demo`), pero algunos navegadores bloquean el acceso a Supabase
desde `file://`.

---

## Anadir empleados

Desde la propia aplicacion: **Empleados > + Nuevo empleado**. Se pide nombre,
usuario, contrasena inicial, rol y comision, y queda todo hecho en un paso.

El usuario se propone automaticamente a partir del nombre ("Ana Torres" ->
`ana.torres`) y es con lo que el empleado inicia sesion. No hace falta que
tenga correo electronico.

### Como funciona por debajo

Supabase autentica siempre con una direccion de correo, asi que la aplicacion
anade el dominio interno definido en la constante `USER_DOMAIN` de `app.js`
(`overspeed.com` por defecto). El usuario `ana.torres` se guarda internamente
como `ana.torres@overspeed.com`, pero ni el empleado ni el administrador
escriben o ven esa direccion en ningun momento.

Si tienes cuentas antiguas creadas con un correo real, siguen funcionando:
escribiendo la direccion completa en el campo Usuario se usa tal cual.

### Si no encuentras el interruptor

Supabase mueve esa opción de sitio cada pocas versiones. Si en el panel del
proveedor Email no aparece **Confirm email**, ejecuta
`supabase/migrations/006_autoconfirmar_cuentas.sql`: instala un disparador que
marca cada cuenta nueva como confirmada nada más crearla, y de paso arregla las
que ya estuvieran pendientes. Es reversible, las instrucciones están en el
propio archivo.

### Ajuste obligatorio en Supabase

En **Authentication > Providers > Email**:

- **Enable email provider** activado, con el registro permitido.
- **Confirm email** DESACTIVADO.

Esto ultimo no es opcional. Los correos internos no existen de verdad, asi que
un mensaje de confirmacion no llegaria a ninguna parte y el empleado nunca
podria entrar. Si ya creaste cuentas con la opcion activada, confirmalas de
golpe en el SQL Editor:

```sql
update auth.users set email_confirmed_at = now() where email_confirmed_at is null;
```

### Por que no hace falta la clave de servicio

La aplicacion crea la cuenta con `signUp`, la misma via que un registro normal,
usando un cliente temporal que no guarda sesion para no desconectar al
administrador. Despues llama a `os_manage('profile_create', ...)`, que comprueba
que quien la invoca es administrador antes de crear el perfil.

Una cuenta sin fila en `os_profiles` no puede hacer nada: la aplicacion deniega
el acceso y todas las politicas RLS dependen de `os_member()`. Por eso el alta
en dos pasos no abre ningun agujero.

## Dar de baja a un empleado

En **Empleados**, cada tarjeta tiene un enlace **Eliminar**. Lo que ofrece
depende de lo que ese empleado haya hecho:

- **Sin ninguna orden registrada** — se elimina el perfil y también su cuenta
  de acceso, con lo que el usuario queda libre para reutilizarlo.
- **Con órdenes activas** — no se puede eliminar. Hay que anular esas órdenes
  primero.
- **Con historial o cortes de pago** — tampoco. Ahí la aplicación ofrece
  desactivar la cuenta: el empleado deja de poder entrar, pero sus trabajos
  facturados siguen contando en estadísticas y cierres.

Esta última regla no es un capricho. `os_orders` y `os_payouts` apuntan al
perfil con claves foráneas: borrarlo dejaría órdenes huérfanas y cuadres
imposibles de reconstruir. En cualquiera de los tres casos queda constancia en
el historial de cambios.

## Logotipos de convenios

Se suben desde la aplicación, en *Inventario / Piezas › Convenios*. Van al
bucket `overspeed-photos`, que crea el esquema con escritura restringida a
administradores. Admite PNG, JPG y WebP hasta 2 MB.

## Problemas frecuentes

**«Tu usuario no tiene perfil en OverSpeed».** La cuenta existe en
Authentication pero falta su fila en `os_profiles`. Revisa el paso 4 o el
apartado de añadir empleados.

**«Solo administradores».** Estás con una cuenta de rol `employee`. Es el
comportamiento correcto: la restricción vive en la base de datos, no en la
interfaz.

**Guardar un convenio con logo da error.** Falta ejecutar
`001_convenios_logo.sql`.

**«Modelo obligatorio» al registrar una orden.** Falta ejecutar
`002_vehiculo_opcional.sql`.

**El botón Borrar de una orden da error.** Falta ejecutar
`003_borrar_orden.sql`. Recuerda que solo borra órdenes ya anuladas.

**Al crear un empleado dice que no existe ninguna cuenta con ese correo.**
El registro está desactivado en Supabase. Activa el proveedor Email en
*Authentication › Providers*.

**El empleado creado no puede entrar** y aparece *Email not confirmed*.
Tienes *Confirm email* activado en Supabase. Desactivalo y confirma las cuentas
ya creadas con la consulta del apartado anterior.

**Quiero probar sin conectar Supabase.** Abre la aplicación añadiendo `#demo`
a la dirección. Carga datos de ejemplo en este navegador y no toca la base de
datos.

**Los cambios de diseño no se ven.** El navegador tiene el CSS en caché.
Recarga forzando con `Ctrl + F5`.
