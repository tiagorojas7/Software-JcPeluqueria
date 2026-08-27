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
      byService: [],
    };

    render(<RevenueSummary revenue={revenue} />);

    expect(screen.getByText(revenue.disclaimer)).toBeInTheDocument();
    expect(screen.getByText(/8\.000/)).toBeInTheDocument();
  });

  // README §"Perfil del barbero": the barber sees "cantidad de cortes" next
  // to what those cuts billed. `GetOwnStatsUseCase` and its endpoint have
  // existed since Phase 11 with no screen rendering them — a total with no
  // count behind it is the ambiguous number the README warns generates
  // arguments.
  describe('cantidad de cortes', () => {
    const revenue: BarberRevenueResponse = {
      totalListPriceCents: 4_860_000,
      disclaimer: 'Facturación teórica según precio de lista.',
      byService: [],
    };

    it('shows how many cuts produced the total', () => {
      render(<RevenueSummary revenue={revenue} stats={{ count: 47, cancelledCount: 4, absentCount: 2, unresolvedCount: 1 }} />);

      expect(screen.getByText('47')).toBeInTheDocument();
      expect(screen.getByText('Cortes realizados')).toBeInTheDocument();
    });

    // Derived here rather than asked of the server: it is exactly
    // total / count, and an endpoint for it would be a second place to keep
    // in step with the two numbers it comes from.
    it('derives the average per cut from the total and the count', () => {
      render(<RevenueSummary revenue={revenue} stats={{ count: 47, cancelledCount: 4, absentCount: 2, unresolvedCount: 1 }} />);

      expect(screen.getByText(/1\.034/)).toBeInTheDocument();
    });

    it('does not divide by zero when the period had no cuts', () => {
      render(<RevenueSummary revenue={{ ...revenue, totalListPriceCents: 0 }} stats={{ count: 0, cancelledCount: 0, absentCount: 0, unresolvedCount: 0 }} />);

      expect(screen.queryByText(/NaN|Infinity/)).not.toBeInTheDocument();
      expect(screen.queryByText('Promedio por corte')).not.toBeInTheDocument();
    });

    // The count arrives from a second request, which can fail on its own.
    // A missing count must not take the total down with it.
    it('still renders the total when the count could not be loaded', () => {
      render(<RevenueSummary revenue={revenue} />);

      expect(screen.getByText(revenue.disclaimer)).toBeInTheDocument();
      expect(screen.queryByText('Cortes realizados')).not.toBeInTheDocument();
    });
  });

  // docs/HUECOS-BACKEND.md #3: el total solo no dice si un mes bueno fue por
  // volumen o por servicios mas caros. `byService` ya viaja en el contrato.
  describe('desglose por servicio', () => {
    const revenue: BarberRevenueResponse = {
      totalListPriceCents: 4_860_000,
      disclaimer: 'Facturación teórica según precio de lista.',
      byService: [
        { serviceId: 's1', serviceName: 'Corte + Barba', count: 21, totalListPriceCents: 2_520_000 },
        { serviceId: 's2', serviceName: 'Corte clásico', count: 18, totalListPriceCents: 1_440_000 },
      ],
    };

    it('abre el total por servicio, con cuántos y cuánto', () => {
      render(<RevenueSummary revenue={revenue} />);

      expect(screen.getByText('Corte + Barba')).toBeInTheDocument();
      expect(screen.getByText('21 cortes')).toBeInTheDocument();
      expect(screen.getByText(/25\.200/)).toBeInTheDocument();
      expect(screen.getByText('Corte clásico')).toBeInTheDocument();
    });

    it('no dibuja la sección cuando el período no tiene nada', () => {
      render(<RevenueSummary revenue={{ ...revenue, byService: [] }} />);

      expect(screen.queryByText(/por servicio/i)).not.toBeInTheDocument();
    });
  });

  // docs/HUECOS-BACKEND.md #4: cinco ausentes en el mes explican un total
  // bajo. Sin eso el barbero ve un numero sin contexto y desconfia.
  describe('los turnos que no se hicieron', () => {
    const revenue: BarberRevenueResponse = {
      totalListPriceCents: 4_860_000,
      disclaimer: 'Facturación teórica según precio de lista.',
      byService: [],
    };

    // "Realizados" no se repite acá: ya es la cifra "Cortes realizados" de
    // arriba, y el mismo numero bajo dos nombres se lee como dos hechos.
    it('cuenta cancelados, ausentes y sin registrar sin repetir los realizados', () => {
      render(
        <RevenueSummary
          revenue={revenue}
          stats={{ count: 47, cancelledCount: 4, absentCount: 2, unresolvedCount: 1 }}
        />,
      );

      expect(screen.getByText('Cancelados')).toBeInTheDocument();
      expect(screen.getByText('Ausentes')).toBeInTheDocument();
      expect(screen.getByText('Sin registrar')).toBeInTheDocument();
      expect(screen.queryByText('Realizados')).not.toBeInTheDocument();
      // El 47 aparece una sola vez en toda la pantalla.
      expect(screen.getAllByText('47')).toHaveLength(1);
    });

    // Solo los realizados suman: decirlo evita que el barbero espere ver los
    // pendientes reflejados en el total.
    it('aclara que solo los realizados suman a la facturación', () => {
      const { container } = render(
        <RevenueSummary
          revenue={revenue}
          stats={{ count: 47, cancelledCount: 0, absentCount: 0, unresolvedCount: 3 }}
        />,
      );

      expect(container.textContent).toMatch(/solo los .*realizados.* suman/i);
    });
  });
});
