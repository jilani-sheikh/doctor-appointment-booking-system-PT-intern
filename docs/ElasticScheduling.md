# Antigravity Implementation Prompt – Elastic Scheduling Enhancement (Medrella)

## 1. Project Context

We are working on the existing Doctor Appointment Booking System (Medrella), built using:

- Next.js App Router
- TypeScript
- Tailwind CSS / shadcn UI
- Prisma ORM
- PostgreSQL (Neon)
- Resend for email notifications

An Elastic Scheduling feature has already been implemented. It supports expanding and shrinking doctor availability at either the START or END edge.

The current implementation has some limitations that need to be addressed based on mentor feedback.

**Your task is to enhance the existing Elastic Scheduling functionality without changing or breaking any other functionality in the application.**

---

## 2. STRICT SCOPE AND NON-NEGOTIABLE REQUIREMENTS

These requirements must be followed throughout implementation.

### A. Preserve the existing architecture

- Do not redesign the scheduling module.
- Do not rewrite the existing booking system.
- Do not replace existing Wave or Stream scheduling implementations.
- Do not remove or modify unrelated features.
- Do not introduce unnecessary new abstractions, services, tables or dependencies.
- Reuse existing server actions, validation schemas, Prisma models, booking logic and notification infrastructure wherever possible.
- Maintain existing API contracts unless a minimal change is absolutely necessary.
- Preserve existing authentication, authorization, role checks and doctor ownership validations.

### B. Preserve Wave scheduling

Wave scheduling currently has:

- A parent availability record (`WAVE_PARENT`).
- Individual child availability records (`WAVE_SLOT`).
- Each child record represents a discrete appointment subslot.
- Capacity is maintained independently for each subslot.

**Do not change this structure.**

Elastic Scheduling must continue to work with these existing parent-child relationships.

When expanding:
- Create only the required new Wave child slots.
- Associate them with the correct parent availability.
- Preserve existing subslots and their bookings.

When shrinking:
- Remove only the subslots that fall outside the new availability.
- Never delete a booked subslot or its appointment.
- Resolve affected bookings before permanently removing the relevant availability.

### C. Preserve Stream scheduling

Stream scheduling currently has:

- One continuous availability record (`STREAM_WINDOW`).
- No individual child subslots.
- Capacity belongs to the entire availability window.
- Appointments are booked against the continuous window.
- `slotStart` and `slotEnd` may be null for Stream appointments.

**Do not introduce Wave-style subslots into Stream.**

Do not:
- Generate Stream child availability records.
- Introduce duration-based appointment allocation.
- Change Stream into a discrete-slot scheduling system.
- Change its existing capacity model.
- Add duration-based capacity calculations.

Stream must remain a continuous availability window with its existing booking and capacity semantics.

When a Stream window is shrunk and individual appointment times are unavailable, treat all active bookings associated with that window as potentially affected. Do not invent appointment times or assume that every appointment has a specific position within the window.

Use alternative Stream availability windows for rescheduling, respecting the existing Stream booking model.

### D. UI requirements

Keep the doctor-facing UI simple.

The doctor should have the existing Expand and Shrink operations.

The doctor should not have to understand:
- Appointment overlap calculations.
- Wave parent-child relationships.
- Stream capacity calculations.
- Rescheduling internals.
- Database-level scheduling rules.

The backend must handle these responsibilities.

Do not redesign the existing doctor dashboard or slot-management page. Make only the minimum UI changes necessary to support the improved Elastic Scheduling workflow.

---

## 3. Existing Implementation – Inspect Before Changing

The existing implementation includes the following files and functions.

### UI

`src/app/doctor/slots/slot-list.tsx`

- `ElasticControls`
- `ElasticDialog`
- Expand and Shrink operations.
- START / END edge selection.
- Steps-based adjustment.
- Apply-to-future functionality.
- Existing schedule preview.

### Validation

`src/lib/validations/slots.ts`

- `elasticAvailabilitySchema`

### Scheduling calculations

`src/lib/scheduling.ts`

- `calculateElasticRange()`
- `diffAvailabilityIntervals()`

### Server actions

`src/lib/actions/slots.ts`

- `elasticAvailabilityAction()`
- `shrinkAvailabilityAction()`
- `expandAvailabilityAction()`

### Appointment booking

`src/lib/actions/appointments.ts`

Inspect:
- Wave appointment booking.
- Stream appointment booking.
- Availability capacity checks.
- Appointment status transitions.
- Appointment cancellation and rescheduling functionality, if present.

### Email notifications

Inspect the existing Resend integration and reuse it.

Also inspect existing notification delivery records, retry handling and email templates.

Do not create a second email notification infrastructure.

---

## 4. Main Functional Requirements

### Feature 1: Schedule Expansion

Doctors must be able to expand availability from either edge.

Examples:

Original: 09:00 AM – 10:00 AM

- Expand START: 08:30 AM – 10:00 AM.
- Expand END: 09:00 AM – 10:30 AM.

Expected backend behaviour:

1. Validate the modification.
2. Calculate the new availability range.
3. Identify newly added intervals.
4. Check past-time restrictions.
5. Check approved doctor time off.
6. Check overlapping availability and scheduling conflicts.
7. Create new Wave child subslots when applicable.
8. Extend the existing parent availability or Stream window.
9. Preserve every existing appointment.
10. Preserve existing capacity rules.
11. Trigger existing waitlist notifications where appropriate.
12. Revalidate relevant application paths.

For Stream, expanding the window must not automatically increase its total capacity or introduce subslots.

Existing appointments must remain untouched.

### Feature 2: Schedule Shrinking

Doctors must be able to shrink availability from either edge.

Examples:

Original: 09:00 AM – 10:00 AM

- Shrink START: 09:30 AM – 10:00 AM.
- Shrink END: 09:00 AM – 09:30 AM.

The current implementation rejects shrinking whenever active appointments exist in removed intervals.

This behaviour must be enhanced.

**The doctor should not be prevented from requesting a schedule modification merely because appointments already exist.**

Instead, implement a safe appointment-rescheduling workflow.

---

## 5. Affected Appointment Detection

### Wave scheduling

Because Wave has individual subslots, identify appointments associated with the subslots that fall outside the new availability range.

Use the actual appointment/subslot relationships and existing active appointment statuses.

Do not rely only on parent availability overlap.

Distinguish:
- Affected appointments.
- Unaffected appointments.
- Empty subslots that can safely be removed.

Preserve all unaffected appointments and their existing subslots.

### Stream scheduling

Stream does not have individual subslots or individual appointment times in the current implementation.

Inspect the actual appointment schema and booking behaviour.

When an existing Stream booking does not contain enough information to determine its individual appointment time:

- Treat every active booking in the affected Stream window as potentially affected by a shrink.
- Do not use the parent window's start and end as if they were the patient's actual appointment time.
- Do not introduce artificial appointment-time allocation.
- Do not generate Stream subslots.
- Offer alternative Stream availability windows using the existing booking model.

This is important because the system must not incorrectly conclude that an appointment is safe or affected based on a fabricated time.

---

## 6. Patient Rescheduling Workflow

Our chosen business decision is:

**Affected patients should be offered alternative appointments instead of having their appointments automatically cancelled.**

Implement the following workflow.

### Step 1: Doctor initiates Shrink

When the doctor requests a shrink:

1. Validate the requested change.
2. Calculate the new range and removed intervals.
3. Identify affected appointments.
4. Create a pending schedule modification.
5. Create individual rescheduling requests for affected appointments.
6. Temporarily prevent new bookings in the requested removed interval.
7. Preserve the original availability and existing appointments while rescheduling is pending.

Do not permanently update the schedule range yet.

Do not delete booked Wave subslots.

Do not cancel existing appointments.

### Step 2: Find alternative availability

Reuse the existing appointment availability-search and booking logic.

Look for alternatives that satisfy:

- Doctor availability.
- Existing capacity rules.
- No conflicting bookings.
- No approved time off.
- Applicable patient and clinic eligibility rules.

For Wave:
- Alternative appointments should use existing available Wave subslots.

For Stream:
- Alternative appointments should use existing available Stream windows.
- Do not introduce discrete appointment subslots.

Do not reserve all proposed alternatives merely because an email was sent.

### Step 3: Notify affected patients

Use the existing Resend integration.

Send an email containing:

- Doctor/clinic information.
- Original appointment details.
- Reason for rescheduling.
- Available alternative options.
- A secure action link to review and select an alternative.
- A clear explanation of what the patient should do next.

Use the existing notification infrastructure wherever possible.

### Step 4: Patient selects an alternative

When the patient accepts an alternative:

1. Verify patient ownership of the appointment.
2. Verify the rescheduling request is still pending.
3. Verify that the selected alternative is still available.
4. Recheck capacity and scheduling conflicts.
5. Reserve the selected alternative.
6. Update the existing appointment using the existing booking model.
7. Preserve the original appointment until the alternative reservation succeeds.
8. Mark the rescheduling request as accepted.
9. Send a confirmation email through Resend.

All relevant database changes must be atomic.

If the selected alternative is no longer available, do not change the original appointment. Show refreshed alternatives.

### Step 5: Patient declines or does not respond

- Do not automatically cancel the appointment.
- Allow the patient to review another alternative.
- Introduce an appropriate response deadline.
- If the patient does not respond, escalate the request to the doctor/clinic.
- If no suitable alternative exists, provide a manual resolution path.
- Preserve the original booking until an explicit resolution is reached.

Do not silently cancel, refund or move a patient.

---

## 7. Pending Modification and Finalization

Introduce a pending modification lifecycle using the minimum necessary database changes.

Inspect the existing schema before deciding whether new models or fields are required.

If an additive model is necessary, a conceptual structure could be:

`ElasticChangeRequest`

- Doctor reference.
- Availability reference.
- Operation (SHRINK / EXPAND).
- Edge (START / END).
- Original start and end.
- Requested start and end.
- Status.
- Timestamps.

Suggested statuses:

- PENDING_RESCHEDULING
- READY_TO_APPLY
- APPLIED
- CANCELLED
- FAILED

Individual patient rescheduling requests should be linked to the parent elastic modification.

Use an existing rescheduling model if one already exists and can be safely reused.

Do not duplicate existing appointment-rescheduling infrastructure.

### Finalization conditions

The actual shrink should be finalized only when:

1. Every affected appointment has been successfully rescheduled or otherwise explicitly resolved.
2. No active unresolved appointment remains in the removed interval.
3. The requested modification is still valid.
4. The doctor and availability are still eligible for the change.

Once all conditions are satisfied:

- Update the existing availability range.
- Remove only empty Wave child subslots outside the new range.
- Preserve unaffected Wave child subslots.
- Update the existing Stream window without creating subslots.
- Synchronize the underlying recurring schedule definition where required.
- Mark the modification as APPLIED.
- Release temporary restrictions appropriately.
- Revalidate relevant pages.

Never finalize a shrink while an unresolved active booking remains in the removed interval.

Do not keep a database transaction open while waiting for patient responses.

---

## 8. Resend Email Notifications

Reuse the existing Resend integration.

Required notification events:

1. Rescheduling request sent to affected patient.
2. Alternative appointment successfully confirmed.
3. Rescheduling request escalated when necessary.
4. Schedule modification successfully completed, if appropriate for doctor notifications.

Important requirements:

- Do not send emails before successful database commits.
- Avoid duplicate emails.
- Track delivery using the existing notification infrastructure.
- Handle email delivery failures.
- Use retry mechanisms where available.
- Do not send cancellation or refund confirmation emails unless those operations actually occurred.

Prefer the existing notification delivery mechanism or a transactional outbox if the existing architecture supports it.

Do not introduce another email provider.

---

## 9. Recurring Schedule Compatibility

The existing implementation supports applying modifications to a selected date or future recurring dates.

Preserve this functionality.

Inspect how `AvailabilitySchedule` and generated `Availability` records are related.

Ensure that a successful future recurring schedule modification does not result in newly generated dates reverting to the old schedule times.

For individual-date modifications, preserve the existing instance-level exception behaviour.

For multi-date modifications:

- Identify conflicts independently.
- Avoid silently leaving the schedule definition and generated instances inconsistent.
- Report dates that could not be modified.
- Do not partially apply changes without recording their outcomes.

Do not redesign the existing recurring scheduling system.

---

## 10. Database and Transaction Safety

Use the existing Prisma/PostgreSQL architecture.

Ensure:

- Appointment updates and alternative reservations are atomic.
- Capacity cannot be exceeded.
- Concurrent patients cannot reserve the same final available capacity.
- Duplicate pending elastic modifications are prevented.
- A second conflicting modification cannot overwrite an unresolved pending modification.
- Existing appointments are never deleted as a shortcut.
- Temporary booking restrictions are safely removed after cancellation or successful finalization.
- Failed transactions do not leave partially modified availability.

Use short database transactions.

Do not make external Resend API calls inside database transactions.

Follow the existing project's database and concurrency patterns.

Only introduce schema migrations when genuinely necessary. Keep migrations additive and backward-compatible wherever possible.

---

## 11. Testing Requirements

Test the feature using real database-backed application flows.

### Wave scheduling

1. Create a Wave schedule.
2. Generate its subslots.
3. Book all available appointments.
4. Expand START.
5. Expand END.
6. Shrink START with affected appointments.
7. Shrink END with affected appointments.
8. Complete patient rescheduling.
9. Verify original unaffected bookings remain intact.
10. Verify only eligible empty subslots are removed.

### Stream scheduling

1. Create a Stream window.
2. Book all available capacity.
3. Expand START and END.
4. Shrink START and END.
5. Verify that the existing continuous-window structure is preserved.
6. Verify no Stream child subslots are created.
7. Verify affected bookings are handled conservatively because individual appointment times are unavailable.
8. Verify capacity remains correct.

### Patient workflow

1. Patient receives a rescheduling email.
2. Patient opens the rescheduling link.
3. Patient selects an available alternative.
4. Appointment is successfully updated.
5. Patient receives a confirmation email.
6. Patient declines an alternative.
7. Patient receives another alternative where available.
8. Patient does not respond before the deadline.
9. Request is escalated without silently cancelling the appointment.
10. Alternative becomes unavailable before acceptance.

### Regression testing

Verify that the following existing functionalities continue working:

- Normal doctor schedule creation.
- Wave scheduling.
- Stream scheduling.
- Patient appointment booking.
- Doctor appointment management.
- Appointment cancellation.
- Payment and refund functionality.
- Doctor time-off management.
- Recurring schedules.
- Patient notifications.
- Waitlist notifications.
- Doctor and patient dashboards.

Do not break existing functionality while implementing Elastic Scheduling.

---

## 12. Implementation Instructions – Follow This Order

Do not immediately start modifying multiple files.

Follow this process:

**Phase 1 – Codebase inspection**

- Inspect the relevant Prisma models.
- Trace Wave and Stream booking flows.
- Understand existing appointment rescheduling functionality.
- Inspect existing Resend integration.
- Identify reusable functions.
- Identify the minimum required schema changes.

**Phase 2 – Present implementation plan**

Before modifying code, provide:

- Existing architecture findings.
- Files that need modification.
- New files, if genuinely required.
- Required Prisma migration changes.
- Exact implementation sequence.
- Potential regression risks.

**Phase 3 – Implement backend changes**

Implement affected appointment detection, pending modification, patient rescheduling, booking validation and schedule finalization.

**Phase 4 – Implement minimum UI changes**

Keep the existing Expand and Shrink UI.

Add only the necessary patient-facing rescheduling and confirmation experience.

Do not redesign unrelated pages.

**Phase 5 – Integrate Resend**

Implement patient notification events and delivery tracking.

**Phase 6 – Test and report**

Run the relevant tests, Prisma validation, TypeScript checks and build.

Report all changes and any remaining limitations.

---

## 13. Final Constraints and Expected Deliverable

The final implementation must satisfy these conditions:

1. Existing Wave parent-child architecture remains unchanged.
2. Existing Stream continuous-window architecture remains unchanged.
3. No Stream subslots are introduced.
4. Existing booking functionality remains intact.
5. Existing appointments are not silently cancelled or deleted.
6. Affected patients receive rescheduling options.
7. Patient acceptance updates the existing appointment safely.
8. Resend is used for email notifications.
9. Doctor schedule changes are finalized only after affected bookings are resolved.
10. Existing recurring schedule functionality continues working.
11. Existing payment, refund and notification systems are reused.
12. No unrelated application functionality is removed or redesigned.

**Most importantly: Implement only the Elastic Scheduling enhancements requested here. Do not use this task as an opportunity to refactor or redesign the rest of Medrella.**

At completion, provide:

- Summary of changes.
- Files modified and created.
- Prisma schema and migration changes.
- Explanation of Wave shrink/expand handling.
- Explanation of Stream shrink/expand handling.
- Patient rescheduling workflow.
- Resend notification workflow.
- Test results.
- Any remaining edge cases or limitations.

If an existing implementation detail conflicts with these requirements, stop and explain the conflict before making a potentially breaking architectural change.

The priority is to deliver a reliable Elastic Scheduling enhancement while preserving the existing application's architecture and functionality.