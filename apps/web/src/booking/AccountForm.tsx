import { useState, type FormEvent } from 'react';
import type { ConfirmReservationRequest } from '@jc-barberia/contracts';

export interface AccountFormProps {
  readonly holdId: string;
  readonly onSubmit: (input: ConfirmReservationRequest) => void;
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
 */
export function AccountForm({ holdId, onSubmit }: AccountFormProps) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [age, setAge] = useState('');

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit({
      holdId,
      client: {
        name,
        phone,
        email,
        age: age.trim() === '' ? null : Number(age),
      },
    });
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
