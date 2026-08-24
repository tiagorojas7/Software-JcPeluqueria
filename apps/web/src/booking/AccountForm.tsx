import { useState, type FormEvent } from 'react';
import type { AccountProfileResponse, ConfirmReservationRequest } from '@jc-barberia/contracts';

export interface AccountFormProps {
  readonly holdId: string;
  readonly onSubmit: (input: ConfirmReservationRequest) => void;
  /**
   * A returning client's own stored details (`GET /account/profile`),
   * already resolved by the page from the session cookie — `null`/`undefined`
   * when there is no client session at all, in which case this form behaves
   * exactly as it always has: a blank form for a first-time visitor.
   */
  readonly initialProfile?: AccountProfileResponse | null;
}

/**
 * client-booking spec, "Cuenta sin contraseña creada al final del flujo"
 * (tasks 9.5/9.6): nombre, teléfono and email are all `required` — unlike
 * `PhoneAppointmentForm`, email is NOT optional here (the requirement:
 * passwordless web access depends on it). There is no password field in
 * this component, anywhere, under any name — the same structural-absence
 * technique `ClientAccountRepository` uses on the backend. Purely
 * presentational: it reports the built `ConfirmReservationRequest` to
 * `onSubmit`, never calls an API itself, same container/presentational
 * split as `PhoneAppointmentForm`.
 *
 * panel-usable: "a client who already has an account fills in name, email
 * and phone again on every booking" — when `initialProfile` is given (the
 * page already resolved a live client session), this opens in a compact
 * confirm step instead of a blank form: the stored details, and one button.
 * "Editar mis datos" is the escape hatch for a stale/wrong value, never a
 * dead end — it falls through to the SAME editable form a first-time
 * visitor sees, just pre-filled instead of blank. A visitor with no session
 * never sees the confirm step at all: `initialProfile` is
 * `null`/`undefined`, `editing` starts `true`, and this renders exactly the
 * form it always did.
 */
export function AccountForm({ holdId, onSubmit, initialProfile }: AccountFormProps) {
  const [name, setName] = useState(initialProfile?.name ?? '');
  const [phone, setPhone] = useState(initialProfile?.phone ?? '');
  const [email, setEmail] = useState(initialProfile?.email ?? '');
  const [age, setAge] = useState(initialProfile?.age != null ? String(initialProfile.age) : '');
  const [editing, setEditing] = useState(!initialProfile);

  function buildRequest(): ConfirmReservationRequest {
    return {
      holdId,
      client: {
        name,
        phone,
        email,
        age: age.trim() === '' ? null : Number(age),
      },
    };
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit(buildRequest());
  }

  if (initialProfile && !editing) {
    return (
      <div className="account-form__confirm">
        <p>Ya tenemos tus datos:</p>
        <ul>
          <li>Nombre: {name}</li>
          <li>Teléfono: {phone}</li>
          <li>Email: {email}</li>
        </ul>
        <button type="button" onClick={() => onSubmit(buildRequest())}>
          Confirmar y continuar
        </button>
        <button type="button" onClick={() => setEditing(true)}>
          Editar mis datos
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor="account-name">Nombre</label>
      <input id="account-name" required value={name} onChange={(e) => setName(e.target.value)} />

      <label htmlFor="account-phone">Teléfono</label>
      <input id="account-phone" required value={phone} onChange={(e) => setPhone(e.target.value)} />

      <label htmlFor="account-email">Email</label>
      <input id="account-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />

      <label htmlFor="account-age">Edad (opcional)</label>
      <input id="account-age" type="number" value={age} onChange={(e) => setAge(e.target.value)} />

      <button type="submit">Confirmar reserva</button>
    </form>
  );
}
