# Talkative — reglas para trabajo con múltiples agentes

Estas reglas aplican a todo el repositorio.

## Fuente de verdad

Para el MVP de agente representante, leer en este orden:

1. `.specify/memory/constitution.md`
2. `specs/001-medical-appointment/spec.md`
3. `specs/001-medical-appointment/plan.md`
4. `specs/001-medical-appointment/tasks.md`
5. la tarea asignada y sus contratos

Si el código, un documento anterior o una instrucción de tarea contradicen la constitución, detenerse y escalar la contradicción al integrador.

## Modelo de colaboración

- Un agente trabaja en una sola tarea `T###` por vez.
- El integrador asigna tareas cuyas dependencias estén completas.
- Cada tarea declara archivos permitidos, contrato de entrada, contrato de salida y comando de validación.
- No modificar archivos fuera del ownership de la tarea.
- No cambiar contratos compartidos para hacer pasar una implementación. Proponer el cambio al integrador.
- El integrador es el único owner de wiring global, contratos aceptados y validación E2E final.
- Los agentes de conversación no ejecutan efectos externos.
- Los agentes de adaptadores no deciden consentimiento ni éxito del caso.
- El `CaseManager` es el único componente que puede cambiar el estado de un caso.

## Formato obligatorio de entrega

Cada agente debe informar:

```text
Tarea:
Archivos modificados:
Contrato consumido:
Contrato producido:
Pruebas ejecutadas:
Resultado:
Riesgos o decisiones pendientes:
```

Una tarea no está terminada por compilar. Deben cumplirse sus criterios Given/When/Then y adjuntarse el resultado de los comandos indicados.

## Límites

- Sólo datos sintéticos.
- Sin secretos, credenciales ni red real en tests.
- Ningún evento analítico puede contener nombres completos, documentos, fecha de nacimiento, texto clínico o contenido de artefactos.
- Ningún efecto externo sin idempotency key.
- Ningún `Case.completed` sin evidencia validada contra su output contract.
- Consentimiento antes de divulgar datos.
- Tenant isolation obligatorio en repositorios, rutas y pruebas.
- Reloj e IDs deben poder inyectarse en lógica de dominio.

