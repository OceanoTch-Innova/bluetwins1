# Oceanotech — backend de autenticación Piscis

Backend Node.js/Express y SQLite para validar las sesiones Piscis de Supabase y
mantener el contrato Bearer que ya utiliza el dashboard. El backend no crea
usuarios ni permite registro público. No modifica ni protege la descarga del
HTML del dashboard; las rutas de datos son las que exigen autorización.

## Requisitos y configuración

Requiere Node.js 18 o superior y almacenamiento SQLite persistente. Copia
`.env.example` a `.env` localmente y configura los valores en el entorno del
servidor. Nunca añadas `.env`, claves privadas, tokens ni credenciales a Git.

Variables requeridas:

- `SUPABASE_URL`: origen HTTPS del proyecto Supabase.
- `SUPABASE_PUBLISHABLE_KEY`: clave publicable, nunca `service_role`.
- `JWT_ACCESS_SECRET`: al menos 32 bytes aleatorios para firmar los JWT Piscis.
- `PISCIS_REFRESH_ENCRYPTION_KEY`: exactamente 32 bytes aleatorios representados
  como 64 caracteres hexadecimales; cifra el refresh token Supabase que conserva
  el backend.
- `CORS_ORIGIN`: lista separada por comas de orígenes exactos del login. En
  producción debe contener el origen HTTPS del frontend.
- `DB_PATH`: opcional; en producción debe apuntar al volumen SQLite persistente.
- `NODE_ENV=production` y `PORT` según el proveedor.

Genera secretos independientes desde un terminal seguro, sin guardarlos en el
repositorio:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

No se requiere `service_role`. El secreto JWT heredado `JWT_REFRESH_SECRET` ya
no se usa para emitir sesiones nuevas.

## Migración y autorización administrativa

El servidor **no aplica migraciones automáticamente**. Antes de iniciar una
instalación nueva o actualizar el backend, revisa y ejecuta manualmente
`migrations/0001_piscis_supabase_auth.sql` contra la base persistente elegida.
La migración crea tablas de autenticación Piscis (y, en una base vacía, el
esquema heredado vacío necesario para arrancar el backend) y revoca los refresh
tokens heredados existentes; no inserta usuarios ni altera tablas del gemelo.
Haz un respaldo de la base y aplica la migración en una ventana aprobada.

Después, un administrador debe crear/invitar la cuenta mediante el procedimiento
administrativo aprobado de Supabase y añadir explícitamente su identidad
autorizada a `piscis_identities`, usando el UUID de Supabase como `supabase_sub`
y un `identity_id` local único. Por ejemplo, ejecutado manualmente por un
administrador sobre la base correcta:

```sql
INSERT INTO piscis_identities
  (identity_id, supabase_sub, email, display_name, enabled, created_at, updated_at)
VALUES
  ('<uuid-local-nuevo>', '<uuid-del-usuario-supabase>', '<correo-verificado>',
   '<nombre>', 1, unixepoch() * 1000, unixepoch() * 1000);
```

No existe endpoint público de alta ni aprovisionamiento automático. Deshabilita
una identidad poniendo `enabled=0`; las siguientes solicitudes protegidas serán
rechazadas. Cada identidad habilitada recibe los permisos globales que las APIs
protegidas ya conceden; no hay aislamiento por usuario/sitio.

## Flujo y contrato de sesión

1. El cliente Supabase de login usa `persistSession=false` y
   `autoRefreshToken=false`. Envía access y refresh token al endpoint de
   intercambio y no ejecuta `signOut` al transferirlos.
2. `POST /api/auth/supabase/exchange` verifica el usuario en Supabase, exige
   identidad local habilitada, rota el refresh token Supabase y establece la
   cookie opaca `piscis_refresh`.
3. La respuesta entrega el JWT Piscis de acceso y el usuario básico. El login
   guarda esos valores en el formato que espera el dashboard y redirige a
   `/Dashboard/index.html`.
4. El Bearer Piscis dura 15 minutos. Cada API protegida comprueba la sesión
   activa y la autorización local. Cuando el Bearer está expirado, el middleware
   exige además la cookie de sesión vinculada al mismo `sid` y `sub`; la cookie
   por sí sola nunca autoriza. La duración absoluta local es 8 horas y el límite
   de inactividad, 30 minutos.
5. Las cookies rotan de forma atómica al usarse para renovar el acceso. Las
   peticiones concurrentes dentro de 60 segundos reciben el mismo sucesor. El
   backend revalida la sesión Supabase cada 5 minutos. Si Supabase no puede
   confirmarla, las APIs fallan cerradas; si la revocación remota no se puede
   completar durante logout, la sesión Piscis se revoca y se elimina el refresh
   cifrado local.

Supabase y SQLite no comparten una transacción. Si Supabase rota un refresh
token y SQLite falla antes de persistir el sucesor durante una revalidación, el
backend revoca la sesión Piscis local y exige autenticación nueva; nunca intenta
reutilizar a ciegas el refresh token anterior. Si el proceso se interrumpe antes
de esa revocación local, la recuperación segura es invalidar la sesión afectada
en SQLite y pedir un nuevo inicio de sesión. Si no se puede identificar con
certeza la sesión afectada, se deben revocar todas las sesiones Piscis activas y
eliminar sus credenciales remotas cifradas antes de reabrir las APIs; no se debe
intentar reutilizar refresh tokens anteriores. Esta ventana sigue dependiendo
del comportamiento real de Supabase y debe verificarse en el proyecto de
integración dedicado antes de producción.

El proceso invalida y elimina las credenciales Supabase cifradas de sesiones
inactivas, vencidas o de identidades deshabilitadas en una tarea cada minuto;
las solicitudes protegidas comprueban los límites exactos sin esperar a esa
tarea.

El fallback de cookie requiere el mismo origen, `Origin` permitido o
`Sec-Fetch-Site: same-origin`, `SameSite=Strict` y HTTPS en producción. El proxy
same-origin del Worker debe conservar `Cookie`, `Authorization` y `Set-Cookie`.
El backend requiere SQLite de una sola instancia escritora; no escales varias
instancias sobre SQLite local.

## Endpoints

| Método | Ruta | Comportamiento |
|---|---|---|
| POST | `/api/auth/supabase/exchange` | Intercambia una sesión Supabase verificada por una sesión Piscis autorizada. |
| POST | `/api/auth/login` | Deshabilitado; no emite tokens heredados. |
| POST | `/api/auth/register` | Deshabilitado; no crea usuarios. |
| POST | `/api/auth/refresh` | Rechaza refresh heredado y revoca el token presentado si coincide. |
| POST | `/api/auth/logout` | Revoca la sesión Piscis presentada y limpia cookies Piscis/heredada exactas; la revocación remota usa alcance `local`. |
| GET | `/api/auth/me` | Devuelve el perfil de la identidad autenticada. |

Las rutas bajo `/api/v1/twin` y `/api/v1/readings` mantienen su funcionalidad y
siguen usando el middleware de autenticación compartido. El documento HTML del
dashboard puede descargarse sin autenticación; esto no concede acceso a las
APIs de datos.

## Desarrollo y pruebas

```sh
npm ci
npm test
npm start
```

Las pruebas aplican la migración solo en una base SQLite temporal aislada y
usan un doble local de Supabase. No prueban el proyecto Supabase real ni la
configuración de producción. No apuntes `DB_PATH` de pruebas a una base real.

### Integración manual con un proyecto Supabase dedicado

La prueba de integración es opt-in y no usa el `.env` habitual:

1. Crea manualmente un proyecto Supabase dedicado a pruebas, sin datos de
   clientes. Mantén deshabilitado el registro público.
2. Desde `oceanotech-backend`, copia el ejemplo:

   ```powershell
   Copy-Item .env.integration.example .env.integration.local
   ```

   Sustituye los valores ficticios localmente y deja
   `SUPABASE_INTEGRATION_ENABLED=YES` y
   `SUPABASE_TEST_PROJECT_APPROVAL=I_CONFIRM_THIS_IS_A_DEDICATED_TEST_PROJECT`
   únicamente tras verificar que el proyecto seleccionado no es producción.
3. Crea/invita manualmente dos usuarios de prueba en ese proyecto. Configura uno
   como autorizado y otro como no provisionado en `.env.integration.local`.
   No uses cuentas de clientes. No se llama a la API administrativa ni se crean
   usuarios desde el runner.
4. Configura localmente `auth-client.js` para el mismo proyecto de prueba
   (URL y clave publishable). El runner compara el identificador de proyecto del
   cliente, la URL del backend y el identificador seleccionado; no imprime esos
   valores ni claves. No publiques cambios locales de configuración de prueba.
5. Ejecuta primero `npm test` desde la raíz para validar las pruebas locales de
   interfaz, incluida la redirección tras una respuesta de autenticación
   exitosa. Luego, desde `oceanotech-backend`, ejecuta:

   ```sh
   npm run test:integration:supabase
   ```

El runner se detiene antes de cualquier petición de red si falta el archivo de
configuración, el opt-in/aprobación explícitos, alguna cuenta, o si no coinciden
los identificadores de proyecto. Después de validar la configuración, crea una
SQLite temporal fuera del repositorio, aplica exclusivamente
`migrations/0001_piscis_supabase_auth.sql` y provisiona en esa base solo la
identidad Supabase autorizada que acaba de autenticarse. Arranca el backend
contra esa base temporal, prueba credenciales inválidas, intercambio autorizado,
cookie `piscis_refresh` y rechazo de la identidad no provisionada. Finalmente
intenta cerrar únicamente las sesiones de prueba, detiene el backend y elimina
solo el directorio temporal que creó.

El logout de integración solo se considera aprobado cuando el backend responde
explícitamente `remoteRevoked: true`; un HTTP 200 con revocación remota no
confirmada hace fallar el runner sin mostrar credenciales, cookies ni tokens.

La integración ejercita Auth y el backend contra Supabase, pero no controla un
navegador real ni el origen público desplegado. La redirección del cliente se
comprueba por la suite local con una respuesta exitosa simulada; probar el
origen público requeriría un despliegue y queda fuera de este procedimiento.

## Despliegue del backend

Este backend requiere un proceso Node persistente y no es un Cloudflare Worker.
En el proveedor Node configura `npm ci`, `npm start`, Node 18+, `PORT`,
`NODE_ENV=production`, `DB_PATH`, `CORS_ORIGIN` y las variables Supabase/JWT/
cifrado descritas arriba. El almacenamiento debe ser persistente y el servicio
debe tener una sola instancia escritora mientras use SQLite.

El Worker de Cloudflare debe tener su secreto `API_ORIGIN` apuntando al origen
HTTPS del backend; no fijes ni inventes esa URL en el repositorio. El despliegue
de Worker y backend requiere autorización independiente y no forma parte de las
pruebas locales.
