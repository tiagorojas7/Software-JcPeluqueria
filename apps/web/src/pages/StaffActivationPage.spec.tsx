import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiPost } from '../shared/api-client';
import { RouterProvider } from '../shared/router';
import { StaffActivationPage } from './StaffActivationPage';

vi.mock('../shared/api-client', () => ({
  apiPost: vi.fn(),
  describeError: (err: unknown) => (err instanceof Error ? err.message : 'error desconocido'),
}));

// README section 3.9, "Perfil del barbero": *"No es opcional: es la puerta
// por la que entra al sistema."* This is that door. The invite the owner
// sends lands here, and it is the ONLY place in the application where a
// staff password is chosen — by the barber, never by the owner.

function renderAt(search: string) {
  window.history.pushState({}, '', `/personal/activar${search}`);
  return render(
    <RouterProvider>
      <StaffActivationPage />
    </RouterProvider>,
  );
}

const VALID_LINK = '?challengeId=challenge-1&token=tok-abc';

describe('StaffActivationPage', () => {
  beforeEach(() => {
    vi.mocked(apiPost).mockReset();
  });

  it('activates the account with the password the barber typed, sending the link secret they never see', async () => {
    vi.mocked(apiPost).mockResolvedValueOnce({ outcome: 'activated' });
    renderAt(VALID_LINK);

    fireEvent.change(screen.getByLabelText(/^contraseña$/i), { target: { value: 'una-contra-larga' } });
    fireEvent.change(screen.getByLabelText(/repetí la contraseña/i), { target: { value: 'una-contra-larga' } });
    fireEvent.click(screen.getByRole('button', { name: /activar cuenta/i }));

    expect(await screen.findByRole('heading', { name: /cuenta activada/i })).toBeInTheDocument();
    expect(apiPost).toHaveBeenCalledWith('/auth/activate-staff', {
      challengeId: 'challenge-1',
      secret: 'tok-abc',
      newPassword: 'una-contra-larga',
    });
  });

  it('catches a mistyped repeat in the browser — a typo must not burn the activation link', () => {
    renderAt(VALID_LINK);

    fireEvent.change(screen.getByLabelText(/^contraseña$/i), { target: { value: 'una-contra-larga' } });
    fireEvent.change(screen.getByLabelText(/repetí la contraseña/i), { target: { value: 'otra-contra-larga' } });
    fireEvent.click(screen.getByRole('button', { name: /activar cuenta/i }));

    expect(screen.getByRole('alert')).toHaveTextContent(/no coinciden/i);
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('says the link still works after a weak password — the API validates before consuming it', async () => {
    vi.mocked(apiPost).mockResolvedValueOnce({ outcome: 'weak-password', message: 'Muy corta.' });
    renderAt(VALID_LINK);

    fireEvent.change(screen.getByLabelText(/^contraseña$/i), { target: { value: 'corta' } });
    fireEvent.change(screen.getByLabelText(/repetí la contraseña/i), { target: { value: 'corta' } });
    fireEvent.click(screen.getByRole('button', { name: /activar cuenta/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/el enlace sigue sirviendo/i);
  });

  it('sends a dead link back to the owner, without guessing why it died', async () => {
    vi.mocked(apiPost).mockResolvedValueOnce({ outcome: 'rejected' });
    renderAt(VALID_LINK);

    fireEvent.change(screen.getByLabelText(/^contraseña$/i), { target: { value: 'una-contra-larga' } });
    fireEvent.change(screen.getByLabelText(/repetí la contraseña/i), { target: { value: 'una-contra-larga' } });
    fireEvent.click(screen.getByRole('button', { name: /activar cuenta/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/ya se usó o venció/i);
  });

  it('offers no form at all when the link is missing its parameters', () => {
    renderAt('');

    expect(screen.getByRole('heading', { name: /enlace incompleto/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/^contraseña$/i)).toBeNull();
  });
});
