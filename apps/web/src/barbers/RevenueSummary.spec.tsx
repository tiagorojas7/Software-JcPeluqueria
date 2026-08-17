import type { BarberRevenueResponse } from '@jc-barberia/contracts';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RevenueSummary } from './RevenueSummary';

// barber-profile spec, "Facturación teórica por precio de lista":
//
//   Scenario: Facturación mostrada con aclaración
//     GIVEN turnos `realizado` propios con sus precios de lista
//     WHEN el barbero consulta su facturación
//     THEN el sistema muestra el total junto con la aclaración de que es
//          precio de lista, no ganancia ni cobro efectivo
//
// The disclaimer's actual wording is already proven by
// get-own-revenue.spec.ts (application layer) — this test only proves the
// UI renders it VERBATIM, never a client-authored paraphrase that could
// drift from the backend's legally/financially sensitive copy.
describe('RevenueSummary', () => {
  it('renders the total and the exact disclaimer the backend sent', () => {
    const revenue: BarberRevenueResponse = {
      totalListPriceCents: 800_000,
      disclaimer:
        'Facturación teórica según precio de lista: no es tu ganancia ni la plata efectivamente cobrada. El sistema no registra el 50% restante que se cobra en efectivo en el mostrador.',
    };

    render(<RevenueSummary revenue={revenue} />);

    expect(screen.getByText(revenue.disclaimer)).toBeInTheDocument();
    expect(screen.getByText(/8\.000/)).toBeInTheDocument();
  });
});
