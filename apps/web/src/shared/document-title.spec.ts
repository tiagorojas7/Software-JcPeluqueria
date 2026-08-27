import { describe, expect, it } from 'vitest';

import { documentTitleFor } from './document-title';

// La pestaña del navegador decia "Reservá tu turno" en las once secciones,
// incluso con la secretaria parada en Gestion o el duenio en Facturacion.
// Con varias pestanias abiertas — el caso real del mostrador — son todas
// iguales e indistinguibles.
describe('documentTitleFor', () => {
  it('usa el titulo de marca solo en el inicio', () => {
    expect(documentTitleFor('/')).toBe('JC Barbería — Reservá tu turno');
  });

  it('nombra la seccion publica en la que se esta', () => {
    expect(documentTitleFor('/reservar')).toBe('Reservar turno — JC Barbería');
    expect(documentTitleFor('/mi-cuenta')).toBe('Mi cuenta — JC Barbería');
    expect(documentTitleFor('/acceder')).toBe('Ingresar — JC Barbería');
  });

  it('nombra las secciones del panel', () => {
    expect(documentTitleFor('/panel')).toBe('Agenda — JC Barbería');
    expect(documentTitleFor('/panel/gestion')).toBe('Gestión — JC Barbería');
    expect(documentTitleFor('/panel/facturacion')).toBe('Mi facturación — JC Barbería');
    expect(documentTitleFor('/panel/login')).toBe('Acceso staff — JC Barbería');
  });

  it('cae al titulo de marca en una ruta desconocida, nunca a un titulo vacio', () => {
    expect(documentTitleFor('/ruta-que-no-existe')).toBe('JC Barbería — Reservá tu turno');
  });
});
