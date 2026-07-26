# Feature 001 — Turno pediátrico simulado

**Estado:** Specified — contratos v1 validados  
**SDD relacionado:** `docs/SDD-agent-representante-tramites.md`
**Contratos:** `specs/001-medical-appointment/contracts/`

## Objetivo

Permitir que una persona responsable pida por texto un turno pediátrico para un dependiente, confirme la información que se compartirá, autorice el contacto, elija una opción y reciba un comprobante y una proyección de calendario.

## Usuario y valor

Como responsable de un menor, quiero delegar la coordinación de un turno sin repetir información ni perder trazabilidad, para obtener una confirmación verificable y saber qué datos fueron compartidos.

## Alcance

- un agente principal visible;
- conversación sólo por texto;
- un principal y un dependiente sintéticos;
- especialidad pediatría;
- una clínica simulada;
- consentimiento antes de contactar;
- búsqueda, selección y reserva;
- reintentos limitados y handoff;
- comprobante sintético;
- calendario simulado e idempotente;
- línea de tiempo y métricas de producto.

## Fuera de alcance

- diagnóstico o recomendación médica;
- urgencias;
- audio;
- pagos;
- portales o mensajería reales;
- datos personales reales;
- Google Calendar real;
- múltiples clínicas o coberturas complejas.

## Resultado verificable

Un caso sólo puede quedar `completed` cuando existen:

1. `Attempt.status = succeeded`;
2. referencia externa de reserva;
3. profesional o prestador;
4. especialidad;
5. fecha y hora;
6. ubicación o enlace;
7. artefacto de confirmación con checksum;
8. una única `CalendarProjection` sincronizada o un fallo de sincronización explícito que no invalida la reserva.

## Escenario dorado

```gherkin
Feature: coordinar un turno pediátrico

  Scenario: reserva confirmada con consentimiento y calendario
    Given Ana es responsable verificada de Tomás
    And existe una delegación vigente para coordinar turnos
    And la clínica simulada tiene dos turnos de pediatría por la tarde
    When Ana pide un turno para la semana siguiente
    Then el agente resume el objetivo y los datos que compartiría
    When Ana corrige o confirma los datos
    And otorga consentimiento
    Then el agente presenta las opciones disponibles
    When Ana elige una opción
    Then se crea un único intento exitoso con referencia externa
    And se genera un comprobante verificable
    And se crea una única proyección de calendario
    And el caso queda completed
    And la línea de tiempo se puede reconstruir después de reiniciar
```

## Escenarios críticos

1. dato requerido faltante;
2. corrección antes de consentir;
3. consentimiento rechazado;
4. consentimiento revocado;
5. sin disponibilidad;
6. fallo reintentable seguido de éxito;
7. límite de intentos agotado y handoff;
8. respuesta externa tardía y reinicio;
9. doble submit sin duplicar reserva ni calendario;
10. acceso desde otro tenant denegado;
11. calendario falla después de confirmar el turno;
12. evidencia incompleta impide `completed`.

## Requisitos constitucionales

- El agente se identifica como asistente digital.
- El motor conversacional no ejecuta adaptadores.
- El consentimiento registra scope, destinatario, datos, versión y vigencia.
- Todos los efectos externos usan idempotency key.
- Los eventos analíticos están redactados.
- Sólo el `CaseManager` completa el caso.

## Preguntas abiertas

- Método de autenticación del principal en el piloto.
- Evidencia aceptada para verificar responsabilidad sobre el menor.
- Jurisdicción y retención.
- Responsable y SLA del handoff.
