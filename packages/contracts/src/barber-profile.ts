import { z } from 'zod';

export const UpdateBarberProfileSchema = z.object({
  name: z.string().min(1, 'El nombre es obligatorio').optional(),
  email: z.string().email('Email inválido').optional(),
  profileImage: z
    .instanceof(File)
    .refine((file) => file.type === 'image/jpeg' || file.type === 'image/png', {
      message: 'Solo se aceptan archivos JPG y PNG',
    })
    .refine((file) => file.size <= 2 * 1024 * 1024, {
      message: 'El archivo no debe superar los 2MB',
    })
    .optional(),
});

export type UpdateBarberProfileInput = z.infer<typeof UpdateBarberProfileSchema>;