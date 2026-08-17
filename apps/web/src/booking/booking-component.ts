import { useState, useEffect } from 'react';

export interface Slot {
  id: string;
  barberId: string;
  start: string;
  end: string;
}

export interface AvailabilityResponse {
  serviceId: string;
  slots: Slot[];
}

export function useAvailability(serviceId: string, date: string) {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/availability?serviceId=${serviceId}&date=${date}`)
      .then((r) => {
        if (!r.ok) throw new Error('Network error');
        return r.json();
      })
      .then((data: AvailabilityResponse) => setSlots(data.slots))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [serviceId, date]);

  return { slots, loading, error };
}

export function BookingComponent() {
  const [serviceId, setServiceId] = useState('');
  const [date] = useState(() => new Date().toISOString().split('T')[0]);
  const [barberId, setBarberId] = useState('');
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);

  const { slots, loading, error } = useAvailability(serviceId, date);

  if (loading) return <p>Cargando horarios...</p>;
  if (error) return <p style={{ color: 'red' }}>Error: {error}</p>;
  if (!serviceId || slots.length === 0) return null;

  return (
    <div>
      <h3>Disponibilidad de horarios</h3>
      <ul>
        {slots.map((s) => (
          <li key={s.id}>
            <button
              onClick={() => setSelectedSlot(s)}
              style={{ width: '100%', margin: '2px 0', padding: '8px' }}
            >
              {`${s.start} - ${s.end} - Barbería ${s.barberId}`}
            </button>
          </li>
        ))}
      </ul>

      {selectedSlot && (
        <div style={{ marginTop: '16px', padding: '16px', border: '1px solid #ddd', borderRadius: '4px' }}>
          <h4>Hold creado</h4>
          <p>Hold ID: {selectedSlot.id}</p>
          <p>Expira en 15 minutos</p>
          <button onClick={() => setSelectedSlot(null)} style={{ marginTop: '8px' }}>
            Cancelar
          </button>
        </div>
      )}
    </div>
  );
}