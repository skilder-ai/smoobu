# @skilder-ai/smoobu

## 0.2.0

### Minor Changes

- 7d899c7: Properties, reservations and guests.
  
  - Client: `smoobu.properties.list/get`, `smoobu.reservations.list/get` (normalised `Reservation`
    with `status`, `stay`, `guest`, `notes`, `payment`), `smoobu.guests.get/search`, and a
    `paginate()` helper. `pageSize` above 100 is rejected (Smoobu silently ignores it).
  - MCP: new tools `smoobu_list_properties`, `smoobu_get_property`, `smoobu_find_reservations`,
    `smoobu_get_reservation` (booking + property + guest profile, contact details opt-in) and
    `smoobu_read_conversation` (latest messages first, with a reservation header).
    `smoobu_list_messages` is deprecated in favour of `smoobu_read_conversation`.

## 0.1.1

### Patch Changes

- cdffe0c: First release built and published by GitHub Actions with npm trusted publishing: versions now carry
  a signed provenance attestation linking them to this repository. No code changes from 0.1.0.

## 0.1.0

### Minor Changes

- dd6f3bf: Initial release: HMAC-signed Smoobu client with a clean messaging model, and an MCP server exposing
  `smoobu_check_connection`, `smoobu_list_conversations`, `smoobu_list_messages` and (opt-in)
  `smoobu_send_message`.
