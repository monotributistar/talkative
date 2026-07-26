# Contratos de Feature 001

Todos los contratos usan JSON Schema draft-07 y rechazan propiedades no
declaradas. Los fixtures viven en `../fixtures`.

| Contrato | Productor | Consumidor | Autoridad |
|---|---|---|---|
| `TurnDecision` | Conversation Engine | CaseManager | sólo propone el siguiente paso |
| `TaskCommand` | CaseManager/Policy | Task Executor | autoriza una tarea acotada |
| `AdapterResult` | Adapter | Task Executor/CaseManager | informa estado y evidencia |
| `DomainEvent` | servicios de dominio | Event Store/Analytics | registra metadatos redactados |
| `MedicalAppointmentCompletion` | CaseManager | máquina de estados | permite `completed` si toda evidencia valida |

## Reglas de compatibilidad

- Cambios que agregan un campo opcional incrementan la versión menor del
  contrato correspondiente.
- Cambios que eliminan, renombran o vuelven obligatorio un campo requieren una
  nueva versión mayor.
- Los consumidores deben validar antes de procesar.
- Un resultado que no valida se convierte en fallo contractual; nunca se
  interpreta desde texto libre.
- Ningún contrato permite nombres de personas, documentos o texto clínico en
  eventos analíticos.

## Validación

```bash
npm run test:contracts
```

