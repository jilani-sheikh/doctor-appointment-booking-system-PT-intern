# Medrella: Live Queue, Waves, Streams, Dynamic Scheduling and Notifications (single delivery)

Context: main contains the working app (Next.js 16 App Router, Auth.js v5 with Google and credentials, Prisma 7 + Neon adapter, shadcn/ui, Sonner). Slots are created by approved doctors as fixed-length, single-patient slots (Availability). Patients book a slot (Appointment). A partial unique index on appointments(availability_id) WHERE status <> 'CANCELLED' prevents double booking. Build ALL features below in ONE branch: feature/live-queue-waves-scheduling (create from updated main). Do not push.

## Workflow
1. Inspect the repo first. Grep every usage of AppointmentStatus, SlotStatus and the appointment transition code, because new statuses affect badges, tabs, stats, cancel rules and the booking transaction.
2. Present a SHORT plan: the full Prisma schema changes, the status transition table, the file list, and any new dependency (avoid new dependencies; use node:test via tsx for tests). WAIT for my approval once, then build everything without further stops.
3. Verify and report actual results only. Mark anything not executed as UNTESTED.

## Lessons from earlier bugs (mandatory)
- Never pass Prisma objects, Decimal, or class instances to Client Components. Add DTO types and mappers in src/lib/serializers.ts. NavUser stays plain; an unread notification count is passed as a plain number.
- Avoid interactive $transaction where one atomic write or the array form works. Where an interactive transaction is needed, use { maxWait: 10000, timeout: 20000 }, keep it short, and map P2002/P2025/P2028 to friendly messages, logging the full error with console.error.
- Zero-credential invariant: public pages and the build must work with no env vars. The layout/navbar must not query the DB unless a session cookie exists, and must degrade on any DB error.
- Do not run ad-hoc `tsx -e` DB queries. Scripts are files that create their own PrismaClient (Neon adapter + ws), load .env.local via dotenv, call $disconnect() in finally, and never import src/lib/db (server-only).
- Run the dev server in the background, use hard timeouts, test one route at a time, and never loop on retries.
- All times stored in UTC and displayed in Asia/Kolkata through lib/time.ts. Mutations are Server Actions with Zod validation, role and ownership checks, and revalidatePath. Never trust client-supplied ids for ownership, role, or status.

## 1. Schema (one new migration; never edit applied migrations)
Enums:
- AppointmentStatus: ADD CHECKED_IN and IN_CONSULTATION. (Postgres: new enum values cannot be used in the same migration transaction. Do not reference them in the same migration's SQL; the existing partial index only references 'CANCELLED', so keep it.)
- VisitStream { NEW_CONSULTATION, FOLLOW_UP, PRIORITY } (see Streams below).
- WaveStatus { DRAFT, PUBLISHED, CLOSED }.
- NotificationType { APPOINTMENT_CONFIRMED, APPOINTMENT_CANCELLED, APPOINTMENT_RESCHEDULED, DOCTOR_ABSENCE, SLOT_AVAILABLE, WAVE_PUBLISHED, QUEUE_DELAY, GENERAL }.
Appointment: add stream VisitStream @default(NEW_CONSULTATION), checkedInAt, checkedInByUserId String?, actualStartAt, actualEndAt, waveId String? (FK to Wave, SetNull), rescheduledFromAvailabilityId String?, rescheduleCount Int @default(0), disruptedAt DateTime?, disruptionReason String?, delayNotifiedAt DateTime?. Indexes on waveId and (status).
Wave: id, specialization String (department), windowStart, windowEnd (UTC), capacity Int, stream VisitStream? (null = all streams), status WaveStatus @default(DRAFT), notes String?, createdById (FK User), publishedAt DateTime?, createdAt, updatedAt. Index on (specialization, windowStart). CHECK (window_end > window_start) in the migration SQL.
DoctorTimeOff: id, doctorId FK (cascade), startAt, endAt (UTC), reason String?, createdAt. CHECK (end_at > start_at).
Notification: id, userId FK (cascade), type NotificationType, title, body, href String?, readAt DateTime?, createdAt. Index on (userId, readAt, createdAt).
WaitlistEntry: id, patientId FK (cascade), doctorId FK (cascade), earliestDate, latestDate (DateTime), notifiedAt DateTime?, createdAt. @@unique([patientId, doctorId]).
Table names are snake_case plural, consistent with existing models.
IMPORTANT: Prisma may try to drop the hand-written partial unique index (appointments_availability_id_active_unique) and CHECK constraints on a later migrate. Generate the migration with `prisma migrate diff` (offline, from the previous migrations to the new schema), inspect the SQL, and REMOVE any DROP INDEX or constraint drop touching those objects. If a database is configured, verify with a query on pg_indexes that the partial index still exists after migrating and report it. Never claim a migration was applied unless you executed it.

## 2. Status model and transitions (single source of truth in lib/appointment-status.ts, used by every action)
PENDING -> CONFIRMED | CANCELLED
CONFIRMED -> CHECKED_IN | CANCELLED | NO_SHOW (only after slot start + 15 min grace)
CHECKED_IN -> IN_CONSULTATION | CANCELLED | NO_SHOW (doctor only)
IN_CONSULTATION -> COMPLETED
COMPLETED, NO_SHOW, CANCELLED are final.
Update every place that lists statuses: badges, upcoming/past tabs (CHECKED_IN and IN_CONSULTATION count as active/upcoming for today), doctor stats, admin overview counts, patient cancel rule (patients cannot cancel once CHECKED_IN or later), and the slot-release logic (cancel frees the slot, as today).

## 3. Live queue
Check-in:
- Patient self check-in on their own CONFIRMED appointment, only from 30 minutes before slot start until slot end (constants in one place). Doctors and admins can mark a patient as arrived (override, records checkedInByUserId).
- Set checkedInAt via a conditional update (WHERE status = CONFIRMED) so double clicks do nothing harmful.
Doctor queue /doctor/queue (APPROVED doctors only):
- Today's appointments in slot order with patient name, reason, stream badge, status, scheduled time, estimated start and delay.
- Actions: Mark arrived, Start consultation (requires CHECKED_IN; sets IN_CONSULTATION and actualStartAt; enforce ONE in-progress consultation per doctor with a conditional check inside a short transaction; a concurrent second start must fail cleanly), End consultation (COMPLETED and actualEndAt), No-show, Cancel.
- Show "running X min behind" for the doctor, and a summary strip: waiting, in progress, completed, remaining.
Estimated waiting time (pure functions in lib/queue.ts, no DB inside):
- Slots are fixed length, so waiting is delay propagation. For appointments of one doctor on one day in slot order, skipping CANCELLED/NO_SHOW/COMPLETED: expectedEnd of an in-progress consultation = max(now, actualStartAt + slotDuration); each next appointment expectedStart = max(its scheduled start, previous expectedEnd), expectedEnd = expectedStart + slotDuration; delay = expectedStart - scheduled start. Patients not yet checked in still get an estimate. If the previous slot is past and nothing is in progress, previous expectedEnd is its scheduled end, not now. Display as approximate (rounded to 5 min), never as a guarantee.
Patient live view:
- On /patient/appointments and the patient dashboard, a "Today" card per active appointment: scheduled time, arrival window (if a published wave exists), check-in button when allowed, status, queue position, estimated start, and delay. Show a static notice: "For medical emergencies, contact your hospital's emergency line. Do not use this app for emergencies." No triage logic anywhere.
- Auto-refresh with a tiny client component (router.refresh every 30 s, only while the tab is visible). No websockets, no new infrastructure.

## 4. Streams
- A stream is the visit type of an appointment: NEW_CONSULTATION, FOLLOW_UP, PRIORITY. The patient picks NEW_CONSULTATION or FOLLOW_UP in the booking dialog. PRIORITY can only be set by a doctor or admin (never selectable by patients; validate on the server).
- Streams appear as badges in the queue and wave views, and a wave can optionally be limited to one stream. Keep the logic isolated (a single lib/streams.ts with labels and rules) so it is easy to rename or extend later.

## 5. Reschedule, cancel and newly available slots
- Reschedule (patient, own PENDING or CONFIRMED appointment, more than 2 hours before the current slot): choose another AVAILABLE slot of the same doctor (default), in one short transaction: (a) conditional updateMany on the new slot (AVAILABLE and start > now + 1 hour) to BOOKED, count must be 1; (b) update the appointment's availabilityId to the new slot, increment rescheduleCount, set rescheduledFromAvailabilityId, reset status to PENDING if it was CONFIRMED and keep a note; (c) set the old slot to AVAILABLE. Max 2 reschedules per appointment. Clear the waveId. Notify the doctor and the patient.
- Doctors can also reschedule or cancel with a reason, which notifies the patient.
- Newly available slots: whenever a slot returns to AVAILABLE (cancel, reschedule, absence end), find WaitlistEntry rows for that doctor whose date range contains the slot and notify those patients (SLOT_AVAILABLE with a link), set notifiedAt. Patients can join or leave a doctor's waitlist from /doctors/[id] when no slots are free. Notification is a nudge only; booking still goes through the normal atomic booking action.

## 6. Doctor absence handling
- /doctor/time-off: an approved doctor adds an absence (start, end, reason; not in the past; max 30 days). Saving it:
  1. Sets AVAILABLE slots in the range to BLOCKED.
  2. Marks affected active appointments (PENDING/CONFIRMED) as disrupted: set disruptedAt and disruptionReason. Do NOT auto-cancel.
  3. Creates a DOCTOR_ABSENCE notification for each affected patient with a link to a reschedule page.
  Use batched updateMany calls (or the array-form transaction), not a long interactive transaction.
- Patient sees a clear "Your doctor is unavailable" banner on the affected appointment, with Reschedule (same doctor, upcoming free slots), "See other doctors in this specialization", and Cancel (no cancellation-window restriction when disrupted).
- Doctor can delete a future absence: blocked slots that were blocked by that absence and are unbooked return to AVAILABLE; do not touch slots the doctor blocked manually (track this safely, for example by only unblocking slots with no appointment inside the range and telling the doctor how many were restored). Document the rule you chose.
- Emergencies are out of scope: no triage or escalation algorithm. Show the emergency notice only.

## 7. Notifications (in-app only, no email/SMS)
- Notification table plus helper lib/notifications.ts (createNotification, createMany). Create notifications for: appointment confirmed/cancelled/rescheduled, doctor absence, newly available slot, wave published, and a delay notice when a patient's estimated delay exceeds 20 minutes (send at most once per appointment per day using delayNotifiedAt).
- Navbar bell with unread count, dropdown of the latest 10, mark one/all as read (Server Actions), and a /notifications page with pagination. Only plain DTOs reach client components.

## 8. Wave-based arrival management (admin)
- /admin/waves: list by date and specialization with status and fill. Create a wave manually (specialization, date, window start/end in IST, capacity, optional stream) and edit while DRAFT.
- Suggest assignments: for a chosen specialization and date, find CONFIRMED appointments (of APPROVED doctors in that specialization) and group them into the wave windows by slot start time and stream, respecting capacity. Overflow appointments are listed as "unassigned" (never silently dropped).
- Review screen /admin/waves/[id]: assigned appointments table (patient, doctor, slot time, stream), move an appointment to another wave, remove it, then Publish. Publishing is allowed only when the wave has no overflow in the same specialization and date window unresolved, or after the admin explicitly acknowledges it. Publishing sets waveId on appointments, sets status PUBLISHED and publishedAt, and notifies each patient with their arrival window (arrive between X and Y, IST).
- Late changes: appointments confirmed after publishing can be added to a published wave only if capacity remains, else shown as unassigned. If a wave is CLOSED it is read-only.
- Dashboard "expected vs actual": per wave and per day, expected arrivals (assigned appointments), actual check-ins (checkedInAt inside or outside the window), late arrivals, no-shows, and not-yet-arrived. Show on /admin/waves/[id] and as summary cards on the admin dashboard.
- Auto-generate waves: a "Generate waves" action for a specialization and date that creates DRAFT waves from parameters (window length in minutes, default capacity), based on the booked appointment count and the doctors' slot ranges, always as DRAFT for admin review. Keep the algorithm simple and deterministic, and document it in the README.
- Patients see their arrival window on their appointment card and in the notification.

## 9. Navigation and UI
- Doctor nav: Queue, Time off (existing: Appointments, Slots). Patient nav: existing plus notification bell. Admin nav: Waves (existing: Doctors). Use existing design tokens and shadcn components; add skeletons (loading.tsx), empty states, and Sonner toasts for every action. Keep accessibility basics (labels, aria on status badges, focus states).
- Add error.tsx boundaries for the new route segments.

## 10. Tests (no new dependencies)
- Unit tests with node:test run via tsx for lib/queue.ts (delay propagation, in-progress overrun, no-shows skipped, no checked-in patient, empty day), the status transition table, check-in window logic, and wave grouping with capacity overflow. Add npm script "test".
- scripts/test-queue-concurrency.ts (own client, dotenv, $disconnect): two concurrent "start consultation" calls for the same doctor, only one succeeds; two concurrent reschedules into the same slot, only one succeeds; reschedule frees the old slot. Run them only if DATABASE_URL is configured, otherwise mark UNTESTED.
- Re-run scripts/test-booking.ts to make sure the original double-booking guarantee still holds.

## 11. Docs and env
- Update README and AGENTS.md: status model, queue estimate formula, wave workflow, absence handling rule, notification types, stream definition, limitations (in-app notifications only, no email/SMS, polling not realtime, no emergency triage). No new env vars unless unavoidable.
- Update the manual test checklist for patient, doctor and admin flows.

## 12. Verification
Run lint, typecheck, unit tests, build (all with NO credentials). Then, if a database is configured: apply the migration with npm run db:deploy, confirm the partial index still exists, and run the concurrency scripts. Start the dev server in the background and check: public routes return 200 and all protected routes redirect to /sign-in when signed out. Test signed in as doctor, patient and admin in the browser if possible, and check the console for serialization errors. Do not use Playwright if its driver download fails; just report it.

## 13. Git
Branch feature/live-queue-waves-scheduling, small conventional commits grouped logically (schema, queue, streams, reschedule and waitlist, absence, notifications, waves, tests, docs). Do not push.

## 14. Final report (short)
What was built vs skipped, files added/changed, migration name and whether it was applied, the result of the partial-index check, the rule chosen for restoring slots after an absence, test results (run vs UNTESTED), and what I must do manually (apply the migration to Neon before deploying to Vercel, and the manual test steps).