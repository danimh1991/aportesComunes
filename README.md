# Aportes comunes

Aplicación para registrar ingresos y calcular el reparto anual entre cuentas según reglas por fechas y persona.

## Desarrollo

1. Copia `.dev.vars.example` como `.dev.vars`. El PIN predeterminado es `0812` y puede configurarse con `APP_PIN`.
2. Ejecuta `npm install`.
3. Aplica las migraciones locales con `npx wrangler d1 migrations apply aportes-comunes-db --local`.
4. Ejecuta `npm run build` y `npx wrangler dev`.

La aplicación se publica como Cloudflare Worker con D1 en `danieta.com/aportescomunes`.
