/**
 * D.3/D.6: `finance:read:shop` is a real permission the owner holds (Fase
 * 3b seed), and `visiblePanelNavItems` correctly shows "Facturación del
 * local" for the owner because of it — hiding the nav item instead would
 * contradict D.3's own rule ("aparece solo si el actor tiene el permiso"),
 * and this slice does not invent a per-item exception. But no controller
 * anywhere reaches `finance:read:shop` yet (`BarberPerformanceController`'s
 * own doc comment: "la facturación total del local es estructuralmente
 * inalcanzable a través de esta ruta" — there simply is no other route
 * either). Building that endpoint means touching `apps/api`, outside this
 * slice's ownership. This screen is the honest landing spot for a real nav
 * item pointing at a real permission with no feature behind it yet — never
 * a blank area, never technical vocabulary a barbershop owner has no reason
 * to know.
 */
export function ShopRevenuePage() {
  return (
    <section className="panel-page">
      <h2>Facturación del local</h2>
      <p className="empty-state">
        Esta sección está en construcción. Pronto vas a poder ver acá la facturación total del local, sumando a
        todos los barberos.
      </p>
    </section>
  );
}
