import { useState, useEffect } from 'react';
import { RegisterClientUseCase } from '@jc-barberia/application';

export interface BookingComponentProps {
  onSuccess: (userId: string) => void;
  onError: (error: string) => void;
}

export function BookingComponent({ onSuccess, onError }: BookingComponentProps) {
  const [name, setName] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [code, setCode] = useState<string>('');
  const [showRetry, setShowRetry] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [retrying, setRetrying] = useState<boolean>(false);

  useEffect(() => {
    if (code.length === 6) {
      const codeNum = parseInt(code, 10);
      const now = Date.now();
      const isExpired = codeNum < now - 900_000 || codeNum > now + 60_000;
      setShowRetry(isExpired);
    } else {
      setShowRetry(false);
    }
  }, [code]);

  const handleSubmit = async () => {
    if (!name.trim() || !phone.trim() || !email.trim()) {
      onError('Por favor completa todos los campos');
      return;
    }

    setIsSubmitting(true);
    try {
      const registerUseCase = new RegisterClientUseCase();
      const result = await registerUseCase.execute({ name, phone, email });

      if (result.outcome === 'registered') {
        onSuccess(result.userId);
      } else {
        onError('No fue posible registrarte. Intenta nuevamente.');
      }
    } catch (err) {
      onError('Error al registrar. Intenta nuevamente.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRetryClick = async () => {
    setRetrying(true);
    setShowRetry(false);
    setCode('');
    try {
      const registerUseCase = new RegisterClientUseCase();
      await registerUseCase.execute({ name, phone, email });
      setCode('');
    } catch (err) {
      console.error('Error requesting new code:', err);
    } finally {
      setRetrying(false);
    }
  };

  return {
    name,
    setName,
    phone,
    setPhone,
    email,
    setEmail,
    code,
    setCode,
    showRetry,
    retrying,
    isSubmitting,
    handleSubmit,
    handleRetryClick,
  };
}

export type { BookingComponentProps };