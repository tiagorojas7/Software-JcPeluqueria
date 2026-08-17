import { z } from 'zod';

export const availabilityInput = z.object({
  serviceId: z.string().uuid(),
});

export const availabilityOutput = z.object({
  slots: z.array(
    z.object({
      id: z.string().uuid(),
      barberId: z.string().uuid(),
      start: z.string().datetime(),
      end: z.string().datetime(),
    })
  ),
});

export const bookingFormInput = z.object({
  serviceId: z.string().uuid(),
  barberId: z.string().uuid(),
  slotStart: z.string().datetime(),
});

export const bookingFormOutput = z.object({
  holdId: z.string(),
  expiresAt: z.string().datetime(),
});

export const registerClientInput = z.object({
  name: z.string().min(1, 'Nombre requerido'),
  phone: z.string().min(1, 'Teléfono requerido'),
  email: z.string().email('Email inválido'),
});

export const registerClientOutput = z.object({
  userId: z.string(),
  authCode: z.string().length(6, 'Código de 6 dígitos'),
});

export const checkoutInput = z.object({
  holdId: z.string(),
});

export const checkoutOutput = z.object({
  success: z.boolean(),
  redirectUrl: z.string().url().optional(),
});