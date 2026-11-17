---
'@skilder-ai/smoobu': minor
'@skilder-ai/smoobu-mcp': minor
---

Properties, reservations and guests.

- Client: `smoobu.properties.list/get`, `smoobu.reservations.list/get` (normalised `Reservation`
  with `status`, `stay`, `guest`, `notes`, `payment`), `smoobu.guests.get/search`, and a
  `paginate()` helper. `pageSize` above 100 is rejected (Smoobu silently ignores it).
- MCP: new tools `smoobu_list_properties`, `smoobu_get_property`, `smoobu_find_reservations`,
  `smoobu_get_reservation` (booking + property + guest profile, contact details opt-in) and
  `smoobu_read_conversation` (latest messages first, with a reservation header).
  `smoobu_list_messages` is deprecated in favour of `smoobu_read_conversation`.
