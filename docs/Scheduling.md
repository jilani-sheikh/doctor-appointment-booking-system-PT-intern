# IMPLEMENTATION PROMPT: Wave and Stream scheduling (recurring and non-recurring), capacity-aware booking, doctor AND patient portals

The feature specification is the section above this prompt in this same file ("Feature Specification: Wave & Stream Scheduling Implementation"). Follow it. This prompt adds the technical decisions, the patient-portal scope and the safety rules.

Base: branch feature/password-reset-account-deletion (PR #13 is open and unmerged). Create feature/wave-stream-scheduling from it. Do not push, and do not change PR #13 behaviour.
Do NOT open, read, print or quote .env.local or any real .env* file. Do NOT run db:deploy or any command that changes the database: the Neon database is shared with production. Generate migrations offline and give me the exact commands. Live-DB scripts are written but marked UNTESTED unless I tell you the env points at a test database. Never log secrets, emails or tokens. No new dependencies. No Vercel cron.

## Workflow
1. Inspect first: prisma/schema.prisma (Availability, Appointment, SlotStatus, the partial unique index appointments_availability_id_active_unique, unique(doctorId,startTime)), lib/actions/slots.ts, slot-form and slot-list, lib/slots.ts (releaseSlot), bookAppointmentAction, reschedule, cancel (patient, doctor, absence, expiry, account deletion), payments holds and expireStaleHolds, queue.ts, reminders, email and notification templates, doctor-booking-slots, reschedule picker, doctor directory "next available", waitlist, arrival-window ("wave") code, patient dashboard, appointments, payments, receipts and return pages, serializers. Report what already supports capacity (the spec assumes it exists; verify, since the single-patient index suggests it does not).
2. Give a SHORT plan (schema, index swap, generation algorithm, booking algorithm, file list including EVERY patient-portal file touched) and WAIT once for approval, then build to the end.

## Mandatory lessons from earlier bugs
No Prisma objects or Decimal in Client Components (DTOs in serializers.ts). Short interactive transactions with { maxWait: 10000, timeout: 20000 }; prefer conditional updateMany and raw conditional UPDATE with a row count check. Zero-credential build must pass. If catching around cookies(), headers() or auth(), call unstable_rethrow first. UTC storage and IST display via lib/time.ts; every date and weekday computation is done in IST, then converted to UTC. Server Actions with Zod, role and ownership checks, doctorId from the session. No `tsx -e` DB queries; scripts are files with their own PrismaClient (Neon adapter + ws), dotenv, $disconnect in finally, never importing server-only modules. Dev server in the background with hard timeouts.

## 1. Data model (additive migration first)
- Enums: ScheduleType { WAVE, STREAM }, Recurrence { ONCE, RECURRING }, ScheduleStatus { ACTIVE, CANCELLED }, AvailabilityKind { SINGLE, WAVE_PARENT, WAVE_SLOT, STREAM_WINDOW }.
- AvailabilitySchedule (rule): id, doctorId (FK cascade), type, recurrence, startDate, endDate (IST calendar dates; endDate = startDate for ONCE), daysOfWeek Int[] (empty for ONCE), startMinute and endMinute (minutes from IST midnight), durationMinutes, capacity, status, createdAt. Index (doctorId, status).
- AvailabilityException: id, doctorId, scheduleId (FK, nullable for ad-hoc), date (IST date), reason String?, createdAt. unique(scheduleId, date).
- Availability (existing): add kind (default SINGLE), capacity Int @default(1), activeCount Int @default(0) (non-cancelled appointments including payment holds), scheduleId?, parentId? (self relation: WAVE_SLOT -> WAVE_PARENT), exceptionId?. Since a wave parent and its first sub-slot start at the same time, replace unique(doctorId,startTime) with unique(doctorId,startTime,kind) in a separate, reviewed step.
- Appointment: add slotStart DateTime? and slotEnd DateTime? (chosen interval for STREAM; null otherwise). Provide ONE helper effectiveSlot(appointment) = {start: slotStart ?? availability.startTime, end: slotEnd ?? availability.endTime} and use it everywhere an appointment time is read (queue, reminders, emails, notifications, payments, receipts, doctor and patient views, arrival windows, formatSlotRange callers). Audit every use of availability.startTime/endTime and list them.
- Backfill in migration SQL: activeCount = number of non-cancelled appointments per availability; existing rows get kind SINGLE, capacity 1.
- Status semantics: AVAILABLE while activeCount < capacity and not blocked; BOOKED when activeCount >= capacity; BLOCKED unchanged. Legacy single slots behave exactly as today (capacity 1).
- Migrations: (A) additive only: enums, new tables, nullable or defaulted columns, backfill. (B) separate migration that swaps constraints: create first, then drop the old ones:
  - unique index on appointments(availability_id, patient_id) WHERE status <> 'CANCELLED' (a patient cannot hold two seats in one slot or window);
  - for STREAM: unique index on appointments(availability_id, slot_start) WHERE status <> 'CANCELLED' AND slot_start IS NOT NULL (no two active bookings for the same interval; because intervals lie on a grid, this means no overlap);
  - CHECK (capacity > 0), CHECK (active_count >= 0), CHECK on schedule times and duration;
  - only then drop appointments_availability_id_active_unique (this is the one deliberate exception to the "never drop" rule, because capacity above 1 contradicts it). Capacity is enforced by the atomic counter below.
  Inspect the generated SQL for any other DROP and report it. Never edit applied migrations. Because the old production code does not maintain activeCount, document that migration B must be applied immediately before deploying this code, and that A and B must be applied in that order.

## 2. Generation (pure functions in lib/scheduling.ts, unit-tested, no DB)
Input: schedule parameters. Output: list of availability rows.
- Dates: ONCE = the one date. RECURRING = every IST date between startDate and endDate (inclusive, max 90 days) whose weekday is in daysOfWeek. Example check: Mon+Wed, 5 Nov to 5 Dec 2026 gives only Mondays and Wednesdays.
- Validation (Zod and pure): end > start; duration > 0; capacity > 0; window divisible by duration (reject otherwise with a clear message); dates not in the past; recurring needs at least one weekday and endDate >= startDate; STREAM capacity <= window/duration.
- WAVE: per date create one WAVE_PARENT (non-bookable container, never shown as a booking option, capacity not used for booking) plus window/duration WAVE_SLOT children, each with the full capacity. Children link to the parent.
- STREAM: per date create exactly ONE STREAM_WINDOW row with capacity for the whole window. No child rows. Appointment options are computed (start + k*duration), never stored.
- Skip dates that fall inside an AvailabilityException or a doctor DoctorTimeOff (create BLOCKED rows with blockedByTimeOffId as the existing code does).
- Conflict rule: reject creation if any generated bookable row overlaps an existing ACTIVE availability of the same doctor (any kind, ignoring BLOCKED rows and parent containers) or duplicates an identical active schedule. Return the list of conflicting dates; never partially create (all or nothing, in one transaction using createMany). Idempotent for an exact duplicate.
- Preview: a server action previewScheduleAction returns what would be created (count, dates, sub-slots, conflicts) without writing anything. The UI must show the preview and require confirmation.

## 3. Capacity-aware booking (replace the AVAILABLE->BOOKED claim)
In bookAppointmentAction (patient only, keep payments mode, hold, abuse limits, notifications exactly as they are):
- Input: availabilityId and, for STREAM only, intervalStart (ISO). Never trust client capacity, kind, times or counts.
- Atomic claim in one short transaction, using a raw conditional UPDATE and a row count check:
  UPDATE availabilities SET active_count = active_count + 1, status = CASE WHEN active_count + 1 >= capacity THEN 'BOOKED' ELSE status END WHERE id = $1 AND kind IN ('SINGLE','WAVE_SLOT','STREAM_WINDOW') AND status = 'AVAILABLE' AND active_count < capacity AND start_time > now() + interval '1 hour' AND (not on an exception date) RETURNING ...
  If 0 rows: friendly "this slot is full or no longer available". Then insert the Appointment (PENDING_PAYMENT or CONFIRMED as today). Catch P2002 from the new unique indexes (same patient twice, same stream interval twice) and map to friendly messages. If the insert fails, the transaction rolls the counter back.
- STREAM extra validation on the server: intervalStart lies on the grid (start + k*duration), inside the window, in the future by more than 1 hour, and not already taken; set slotStart/slotEnd. Active payment holds count toward capacity and toward the interval.
- WAVE: book against the sub-slot; the parent is never bookable.
- Prevent booking on blocked dates and outside the window.
- Return a structured result for the UI: success, slot_full, interval_taken, already_booked_by_you, blocked_date, too_late, or payment_not_configured, each mapped to one friendly message.

## 4. Releasing capacity (single helper)
Extend releaseSlot(availabilityId) so it decrements activeCount with GREATEST(active_count - 1, 0) and sets status back to AVAILABLE only when not blocked (respecting doctor time-off and exceptions as today) and activeCount < capacity. Use it in every path that frees a seat: patient cancel, doctor cancel, absence cancel, hold expiry and cancel hold, failed payment rollback, reschedule (old slot), account deletion. Reschedule: moving to another slot or interval claims a seat in the new one with the same atomic claim, then releases the old one. Notify the waitlist when a seat is released as today.

## 5. Overrides and blocking by date
- blockScheduleDateAction(scheduleId, date): creates an AvailabilityException for that IST date and blocks that date's rows from that schedule. The recurring rule and all other dates are untouched.
- If active appointments (CONFIRMED, CHECKED_IN, PENDING_PAYMENT, IN_CONSULTATION) exist on that date: reject by default and return the list (counts and times only, no personal data). Offer an explicit second step: confirm "cancel these appointments with refund", which reuses the existing doctor-cancel path (100% refund, patient notified, seat released) and then blocks. Never delete appointments silently, never delete availability rows that have appointments.
- After blocking, the doctor can create a one-time schedule for that date; the conflict check must treat blocked rows and the exception as free.
- unblockScheduleDateAction restores the rows only if no replacement schedule occupies that time.
- cancelScheduleAction(scheduleId): applies to future dates only, same rules (reject or explicit resolution when bookings exist), unbooked rows deleted, past rows untouched.
- Deleting or blocking a single row that has activeCount > 0 is rejected.

## 6. Doctor UI (/doctor/slots, "Generate Availability")
- Step 1: choose Wave or Stream (explain each in one line). Step 2: Recurring or Non-recurring. The remaining fields adapt as in the spec. Show the live preview and conflicts before the Save button. For STREAM show a note: "One window, appointment times are calculated, capacity applies to the whole window".
- Below the form list schedules (type, recurrence, days, times, capacity, booked of capacity) with Cancel schedule and "Block a date" actions and an exceptions list. The existing slot list shows WAVE parents as groups with their sub-slots, seats booked of capacity, and STREAM windows with the booked intervals.
- Keep legacy SINGLE slots visible and manageable as before.
- Responsive layout with no overlapping cards (reuse the grid fixes from PR #13). Accessible labels, toasts, pending states, empty states.

## 7. Patient portal (complete scope)

7.1 Doctor page /doctors/[id] and booking
- Group availability by date. For WAVE, show each sub-slot as a button with the range (formatSlotRange) and "N of M seats left"; when full, show it disabled with the label "Full". Never show WAVE_PARENT rows.
- For STREAM, show one card per date: the window range, "N of M seats left" for the whole window, and the computed interval buttons (start + k*duration). Intervals already taken are disabled and labelled "Taken". When the window is full, disable every interval and show "Full".
- Re-fetch seat counts when the booking dialog opens and handle "slot full" at submit time with a friendly message and an automatic refresh of the list (another patient may have taken the last seat).
- Booking dialog shows: doctor, date, chosen range (stream interval or wave sub-slot), fee, hold time (20 minutes), refund policy. Same dialog for both types.
- Waitlist: "Join waitlist" appears when a doctor has no seats left in the next 14 days; releasing a seat notifies matching waitlist entries as today.
- Blocked dates and exception dates show nothing bookable (no empty cards).

7.2 Patient appointments (/patient/appointments), dashboard, payments
- Every appointment shows its effective range via effectiveSlot (stream interval, wave sub-slot, or legacy slot). Add a small badge "Wave" or "Stream" only if it helps, never the word "wave" for arrival windows.
- PENDING_PAYMENT holds show the same range and the countdown. Receipts, payment history, return page, emails and in-app notifications use effectiveSlot.
- Check-in window, cancel rule (2 hours), refund policy and "today" card use the effective start.
- Dashboard "next appointment" and counts use effectiveSlot.

7.3 Reschedule (/book/reschedule/[appointmentId])
- Same picker as 7.1 (sub-slots with seats, stream intervals). Only slots of the same doctor, not full, not the current seat. Stream reschedule picks a new interval. Max 2 reschedules and the 2-hour rule stay.

7.4 Doctor directory (/doctors)
- "Next available" and any availability indicator are computed from seats (activeCount < capacity), earliest bookable sub-slot or stream interval, ignoring parents, blocked rows and exceptions. Show "No seats available" when none.
- Optional filter "Available this week" must use seats.

7.5 Doctor absence and blocked-date effects on patients
- When a doctor blocks a date with bookings (explicit resolution), affected patients get an in-app notification and an email with the date and range, the refund line (initiated, never "refunded" until SUCCESS), and a link to rebook. A disrupted appointment shows the existing "doctor unavailable" banner with reschedule and cancel.

7.6 Quality
- All DTOs plain (no Prisma objects or Decimals). Responsive layouts without overlapping cards at 360px, 768px and 1280px. Accessible: aria-labels such as "Book 10:00 am to 10:30 am on Mon 9 Nov, 2 seats left", visible focus, disabled states announced. Loading skeletons and empty states ("No availability in the next 14 days").
- Patient-facing wording never mentions internal terms (activeCount, parent, schedule).

## 8. Rename the old "wave" feature to "Arrival Windows" (UI and routes only)
- Rename labels, navigation, headings, notification copy and README wording from Wave to "Arrival Windows". Move the route /doctor/waves to /doctor/arrival-windows with a redirect from the old path (and update notification hrefs). Keep database tables and Prisma model names unchanged. Also rename the visit type "Stream" label (VisitStream: new consultation, follow-up, priority) to "Visit type" in the UI so it is not confused with Stream scheduling.

## 9. Queue, estimates, reminders, payments, arrival windows
- effectiveSlot is used everywhere. Queue ordering: by effective start, then booking time. Several patients can share a WAVE sub-slot: they are seen one after another; expected length per patient = duration / capacity (minimum 5 minutes); document this as an assumption in the README and the report. For STREAM each patient has their own interval. The one-consultation-at-a-time doctor lock stays.
- Patient queue view ("Today" card): for several patients in one WAVE sub-slot, show the position among them and an estimate based on the shared-slot assumption; for STREAM show the patient's own interval. Estimates are labelled approximate.
- Arrival windows and reminders use the effective start. Payment amounts, holds, refunds, receipts and email templates keep working; show the interval for stream bookings.
- Account deletion and the existing blockers keep working with seats.

## 10. Tests and scripts
- Unit tests (node:test): weekday matching (Mon and Wed example), IST boundary dates (23:30 and 00:15), wave sub-slot generation (10:00 to 12:00, 30 min, capacity 3 gives 4 sub-slots), stream single window with computed intervals, validation cases (end before start, duration not fitting, capacity too high for stream, past dates, no weekday), conflict detection, exception handling, grid validation of intervalStart, seat counter logic and releaseSlot arithmetic, legacy SINGLE behaviour unchanged.
- Patient-side tests: seats-left DTO mapping, stream interval availability (taken versus free), full sub-slot disabled, directory next-available ignores parents and blocked rows, effectiveSlot used in receipts, emails and appointment cards, reschedule picker excludes full slots.
- scripts/test-scheduling.ts (own client, TEST- prefixed rows removed in finally; only against a test database, else UNTESTED): 6 concurrent bookings on a capacity-3 wave sub-slot give exactly 3 successes; concurrent bookings of the same stream interval give exactly 1; stream bookings in different intervals succeed up to capacity then fail; the same patient cannot book twice in one slot; hold expiry and cancel return the seat; reschedule moves a seat; blocking a date with bookings is rejected and with explicit resolution cancels, refunds and blocks; override flow (block Monday, create a one-time schedule, other Mondays untouched); duplicate generation is rejected; legacy capacity-1 slot cannot be double booked. Re-run test-booking.ts, test-queue-concurrency.ts and test-payments.ts and update them for the new helpers.
- lint, typecheck, npm run test, build (zero credentials). Dev server checks: public routes 200, protected routes redirect, no serialization errors.
- Manual checklist for the patient flow: book the last seat, a second patient sees "Full", cancel and see the seat return, hold expiry returns the seat, a stream interval taken by another patient shows "Taken", reschedule within the same doctor.

## 11. Docs and git
README and AGENTS.md: model, the index swap and its reasoning, generation rules with worked examples (wave and stream), booking algorithm, release rules, override rules, the Arrival Windows rename, assumptions (divisible windows, overlap rejected, shared sub-slot consultation length), and the exact deployment order (apply migration A, then B, immediately before deploying). Manual test checklist for doctor and patient. Small conventional commits (schema, scheduling core, booking, release, overrides, doctor UI, patient UI, rename, queue, tests, docs), no co-author trailer.

## 12. Final report (short)
Built vs skipped; the audit list of availability.startTime uses and how each was handled; the list of patient-portal files changed; migration names and the exact commands for me to run; the SQL of migration B with the dropped index called out; test results (run vs UNTESTED); assumptions needing instructor confirmation; my manual steps.