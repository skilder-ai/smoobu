/** Wire fixtures shaped like real Smoobu responses (values are invented). */

export const booking = (over: Record<string, unknown> = {}) => ({
  id: 100,
  'reference-id': 'HMABC123',
  type: 'reservation',
  arrival: '2026-12-20',
  departure: '2026-12-27',
  'created-at': '2026-10-18 20:27',
  modifiedAt: '2026-10-18 20:27:49',
  apartment: { id: 10, name: 'Chalet Alpha' },
  channel: { id: 3050531, channel_id: 74, name: 'Airbnb' },
  'guest-name': 'Anna Muster',
  firstname: 'Anna',
  lastname: 'Muster',
  email: 'anna@example.com',
  phone: '+41 00 000 00 00',
  adults: 2,
  children: 1,
  'check-in': '16:00',
  'check-out': '11:00',
  notice: '',
  'assistant-notice': 'Late arrival',
  price: 1200,
  'price-details': 'Base price - CHF 1200',
  'city-tax': null,
  'price-paid': 'Yes',
  'commission-included': 150.5,
  prepayment: null,
  'prepayment-paid': 'No',
  deposit: null,
  'deposit-paid': 'No',
  language: 'fr',
  'guest-app-url': '',
  'is-blocked-booking': false,
  guestId: 77,
  related: [],
  ...over,
});

export const bookingsPage = (bookings: unknown[], page = 1, pageCount = 1) => ({
  page_count: pageCount,
  page_size: 25,
  total_items: bookings.length,
  page,
  bookings,
});

export const apartment = (over: Record<string, unknown> = {}) => ({
  id: 10,
  name: 'Chalet Alpha',
  location: {
    street: 'Rue 1',
    zip: '1854',
    city: 'Leysin',
    state: 'VD',
    country: 'Switzerland',
    latitude: 46.34,
    longitude: '7.01',
  },
  timeZone: 'Europe/Zurich',
  rooms: { maxOccupancy: 4, bedrooms: 2, bathrooms: 1, doubleBeds: 2, singleBeds: null },
  amenities: ['Wifi', 'Fireplace'],
  currency: 'CHF',
  price: { minimal: '150.00', maximal: '320.00' },
  type: { id: 2, name: 'Holiday rental' },
  ...over,
});

export const guest = (over: Record<string, unknown> = {}) => ({
  id: 77,
  firstName: 'Anna',
  lastName: 'Muster',
  companyName: '',
  emails: ['anna@example.com'],
  telephoneNumbers: [{ number: '+41 00 000 00 00' }],
  address: { street: '', postalCode: '', city: '', country: '' },
  notes: 'Prefers French',
  bookings: [booking()],
  ...over,
});

export const message = (id: number, createdAt: string, type = 1, text = `m${id}`) => ({
  id,
  subject: '',
  message: text,
  htmlMessage: '',
  type,
  createdAt,
});

export const messagesPage = (
  messages: unknown[],
  page: number,
  pageCount: number,
  total: number,
) => ({
  page_count: pageCount,
  page_size: 25,
  total_items: total,
  page,
  messages,
});
