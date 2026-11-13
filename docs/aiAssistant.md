## 1. Project Objective

Implement a functional, AI-powered floating chatbot assistant inside both the **Doctor Portal** and **Patient Portal** of the existing Medrella Doctor Appointment Booking System.

The assistant should allow doctors and patients to interact naturally through text and voice, retrieve relevant information, and perform authorized operations through existing backend functionality.

**Important:** This is a conversational AI chatbot with controlled tool calling, NOT an autonomous multi-agent system. Do not introduce unnecessary agent frameworks, microservices, or complex architecture.

The chatbot must perform real operations using the existing database, APIs, server actions, and business logic. Do not use mock data or simulate successful operations.

---

## 2. First: Understand the Existing Codebase

Before implementing anything, thoroughly inspect the project.

Identify:

- Existing Next.js App Router structure.
- Auth.js authentication and user roles.
- Prisma schema and PostgreSQL database.
- Doctor and patient dashboards.
- Appointment booking, cancellation, and rescheduling workflows.
- Wave Scheduling, Stream Scheduling, and Elastic Scheduling.
- Doctor availability, working hours, shifts, and leave management.
- Existing slot generation and conflict detection.
- Cashfree payment integration.
- Refund processing and payment history.
- Prescription-related models and APIs, if available.
- Existing notification and email services.

Reuse existing functions, services, APIs, server actions, and database models wherever possible.

**Do not duplicate existing business logic or rewrite working scheduling and payment functionality.**

Preserve all existing features and workflows.

---

## 3. Floating Chatbot UI

Create one reusable floating AI assistant component shared by both portals.

### UI requirements

- Display a floating chatbot button in the bottom-right corner.
- Clicking it opens a modern chat panel.
- Clicking again or using the close button minimizes it.
- Responsive on desktop, tablet, and mobile.
- Follow the existing Medrella design system, colors, typography, and UI components.
- Use Tailwind CSS and existing shadcn/ui components.
- Display user messages and assistant responses in separate chat bubbles.
- Show typing/loading indicators.
- Display errors gracefully.
- Support scrolling through previous messages.
- Provide a clear conversation reset option.
- Include a text input and send button.
- Include a microphone button for voice input.
- Support structured responses such as appointment cards, doctor cards, available slot lists, and confirmation panels.

The same chatbot component must adapt its capabilities according to the authenticated user's role.

### Suggested component structure

```text
src/
  components/
    ai-assistant/
      FloatingAssistant.tsx
      ChatWindow.tsx
      ChatMessage.tsx
      ChatInput.tsx
      VoiceControls.tsx
      AppointmentCard.tsx
      DoctorCard.tsx
      SlotSelector.tsx
      ActionConfirmation.tsx

  app/
    api/
      ai-assistant/
        chat/
          route.ts
        confirm/
          route.ts

  lib/
    ai/
      model.ts
      tools/
        doctor-tools.ts
        patient-tools.ts
      schemas.ts
      confirmation.ts
```

Adjust this structure to match the existing project conventions. Do not create unnecessary files if equivalent functionality already exists.

---

## 4. Technology Stack

Use the following approach:

- **Frontend:** Existing Next.js, React, TypeScript, Tailwind CSS, shadcn/ui.
- **AI integration:** Vercel AI SDK compatible with the version installed in the project.
- **AI model:** Google Gemini API.
- **Validation:** Zod.
- **Database:** Existing PostgreSQL + Prisma.
- **Authentication:** Existing Auth.js implementation.
- **Voice input:** Browser Web Speech API / SpeechRecognition where supported.
- **Voice output:** Browser SpeechSynthesis API.

Use the Gemini API from the server only.

Store the API key in the environment variable:

```env
GEMINI_API_KEY=your_gemini_api_key
```

Never expose the API key through frontend code, browser requests, or public environment variables.

Before installing or upgrading packages, inspect the current dependency versions and use compatible APIs. Avoid unnecessary package upgrades.

---

## 5. Doctor-Side Assistant

The doctor assistant must understand natural-language requests and retrieve information belonging only to the authenticated doctor.

### A. Appointment Management

Support queries such as:

- "Show my appointments today."
- "Show tomorrow's appointments."
- "Show appointments for 20 November."
- "How many appointments do I have today?"
- "List my completed appointments."
- "Show cancelled appointments."
- "Who is my next patient?"

Display appointment information in structured cards where appropriate.

### B. Appointment Statistics

Provide:

- Total appointments.
- Confirmed appointments.
- Completed appointments.
- Cancelled appointments.
- Pending appointments, if applicable.

Allow date-based statistics.

### C. Availability and Scheduling

Support:

- "Show my availability today."
- "What are my working hours?"
- "Show my upcoming shifts."
- "Do I have any leave scheduled?"
- "Find overlapping appointments."
- "Check scheduling conflicts."
- "Find my next available slot."
- "Suggest alternative slots for this patient."

Reuse the existing scheduling engine and conflict-detection logic.

Do not calculate availability independently if an existing scheduling service already handles it.

### D. Schedule Management

Where existing functionality supports it, allow doctors to request schedule changes through chat.

Examples:

- Create availability for a date.
- Expand availability.
- Shrink availability.
- Block a time period.
- Modify available slots.

Before applying any schedule modification:

1. Understand the requested change.
2. Retrieve the current schedule.
3. Show a clear preview of the proposed changes.
4. Ask the doctor for explicit confirmation.
5. Revalidate availability and conflicts.
6. Execute using existing scheduling services.
7. Display the actual result.

Do not modify schedules merely because the doctor mentioned a possible change.

---

## 6. Patient-Side Assistant

The patient assistant must provide access only to the authenticated patient's information.

### A. Appointment Information

Support:

- "Show my upcoming appointments."
- "Show my previous appointments."
- "When is my next appointment?"
- "Show my appointment history."
- "Show the status of my appointment."

### B. Doctor Search

Allow patients to search doctors by:

- Doctor name.
- Specialization.
- Other existing searchable doctor attributes.

Examples:

- "Find a cardiologist."
- "Show dermatologists."
- "Find Dr. Sharma."

Display matching doctors with relevant information available in the existing database.

### C. Appointment Availability

Support:

- "Show available slots for Dr. Sharma."
- "Can I book an appointment tomorrow?"
- "Find the earliest available appointment."
- "Suggest another slot."

Use the existing appointment availability and scheduling services.

If the requested slot is unavailable, suggest actual alternative slots retrieved from the backend.

### D. Appointment Booking

Allow patients to book appointments through natural conversation.

Expected flow:

1. Patient asks to book an appointment.
2. Assistant identifies the doctor, date, and preferred time.
3. Assistant retrieves available slots.
4. Patient selects a slot.
5. Assistant displays the booking summary.
6. Assistant requests explicit confirmation.
7. Backend revalidates the slot.
8. Existing booking logic creates the appointment.
9. If payment is required, initiate the existing payment workflow.
10. Display the actual booking and payment status.

Never claim an appointment is booked before the backend confirms success.

### E. Rescheduling

Support requests such as:

- "Reschedule my appointment."
- "Move my appointment to tomorrow."
- "Show alternative slots."

Flow:

1. Identify the patient's appointment.
2. Retrieve eligible alternative slots.
3. Display available options.
4. Let the patient select a slot.
5. Show the old and new appointment details.
6. Ask for explicit confirmation.
7. Revalidate availability.
8. Execute through the existing rescheduling service.
9. Display the actual updated status.

Respect existing rescheduling policies and eligibility rules.

### F. Cancellation

Support:

- "Cancel my appointment."
- "I cannot attend tomorrow's appointment."

Flow:

1. Identify the appointment.
2. Display the appointment details.
3. Explain any applicable cancellation or refund policy.
4. Ask for explicit confirmation.
5. Execute using the existing cancellation service.
6. Display the actual cancellation and refund status.

Do not bypass existing cancellation policies.

### G. Payments and Refunds

Integrate with the existing Cashfree payment implementation.

Support:

- Viewing payment history.
- Checking payment status.
- Viewing refund status.
- Initiating payment for eligible appointments.
- Displaying payment summaries and transaction status.

Use the existing payment services and checkout flow.

Never collect card details or sensitive payment credentials directly in chat.

Do not claim a payment or refund succeeded until the backend confirms it.

### H. Prescriptions

First inspect whether prescription models, APIs, and services already exist.

If available, allow patients to view their own prescriptions through authorized backend queries.

If prescription functionality does not exist, do not generate fake prescriptions or fabricate medical records. Report the missing functionality clearly instead.

---

## 7. Voice Assistant

Implement voice functionality after the basic text chatbot works.

The assistant should support:

- Text conversations.
- Voice input.
- Spoken assistant responses.
- English.
- Hindi.
- Hinglish where supported by the browser's speech recognition.
- Language selection.

### Continuous voice interaction

Implement a practical voice conversation flow:

1. Patient or doctor activates voice mode.
2. Browser captures speech.
3. Speech is converted into text.
4. Text is sent to the chatbot.
5. Assistant generates a response.
6. Assistant speaks the response.
7. Microphone recognition pauses while the assistant speaks.
8. Recognition resumes after speech finishes, if voice mode remains active.

### Voice controls

Provide:

- Start voice mode.
- Stop voice mode.
- Interrupt assistant speech.
- Mute/unmute spoken responses.
- Language selection.

Important:

- Prevent the microphone from capturing the assistant's own voice.
- Do not keep microphone recognition active while TTS is speaking.
- Handle microphone permission errors.
- Handle unsupported browsers gracefully.
- Provide text input as a fallback.
- Do not promise identical continuous voice support across all browsers and devices.

Use browser-native speech capabilities for the initial implementation. Avoid paid speech services unless genuinely required.

---

## 8. AI Chat Architecture

Implement a controlled chatbot architecture.

Expected request flow:

```text
User
  |
  v
Floating Chatbot UI
  |
  v
Next.js Chat API
  |
  v
Authenticate User (Auth.js)
  |
  v
Determine User Role
  |
  v
Gemini API through Vercel AI SDK
  |
  v
Role-Specific Tool Calling
  |
  v
Validate Tool Arguments (Zod)
  |
  v
Existing Backend Services
  |
  v
Prisma / PostgreSQL
  |
  v
Structured Response to Chat UI
```

The AI model must not directly access the database or execute arbitrary SQL.

The AI should decide which authorized tool is appropriate. The server must validate the request, enforce permissions, and call the existing business logic.

### Role-specific tools

Create separate tool sets for doctors and patients.

Examples of doctor tools:

- `getDoctorAppointments`
- `getDoctorAppointmentStats`
- `getDoctorAvailability`
- `getDoctorWorkingHours`
- `getDoctorLeaves`
- `detectSchedulingConflicts`
- `findNextAvailableSlot`
- `suggestRescheduleSlots`
- `previewScheduleChange`

Examples of patient tools:

- `getMyAppointments`
- `searchDoctors`
- `getDoctorAvailableSlots`
- `suggestAlternativeSlots`
- `prepareAppointmentBooking`
- `prepareAppointmentReschedule`
- `prepareAppointmentCancellation`
- `getMyPaymentHistory`
- `getMyRefundStatus`
- `getMyPrescriptions`

Tool names are suggestions. Adapt them to existing project services and naming conventions.

Only expose tools appropriate to the authenticated role.

Never trust a user ID, doctor ID, patient ID, or role supplied by the model or frontend. Derive identity from the authenticated server session and validate resource ownership on every request.

---

## 9. Confirmation and Security

This is a healthcare application. Security and authorization are mandatory.

### Explicit confirmation

Require confirmation before:

- Booking appointments.
- Cancelling appointments.
- Rescheduling appointments.
- Modifying doctor schedules.
- Initiating payments where applicable.

Use a clear confirmation card displaying the exact action and its parameters.

For example:

```text
Confirm Appointment Booking

Doctor: Dr. Sharma
Date: 20 November 2026
Time: 10:30 AM
Consultation Fee: ₹500

[Confirm Booking] [Cancel]
```

The example is illustrative. Populate actual values from the backend.

### Secure confirmation implementation

Do not trust a simple frontend boolean such as `confirmed: true`.

Create a secure server-side confirmation mechanism:

- Generate a confirmation identifier or secure token.
- Bind it to the authenticated user, action, and exact validated parameters.
- Set an expiry time.
- Revalidate availability and permissions at execution time.
- Prevent duplicate execution.
- Execute the operation once.
- Return the actual operation result.
- Reject expired, altered, unauthorized, or already-used confirmations.

Use database transactions and existing idempotency mechanisms where appropriate.

### Additional security

- Enforce authentication on every chatbot API.
- Enforce doctor/patient role authorization.
- Prevent cross-patient and cross-doctor data access.
- Validate all tool inputs with Zod.
- Never expose unnecessary patient information.
- Do not expose internal errors, secrets, or stack traces.
- Avoid logging sensitive medical information.
- Apply rate limiting where appropriate.
- Handle expired sessions and failed operations safely.

---

## 10. Conversation Experience

The assistant should understand natural language rather than requiring exact commands.

Examples:

**Patient:**

"Find me a cardiologist."

Assistant retrieves actual doctors and displays matching results.

**Patient:**

"Show available slots for the first doctor."

Assistant uses the selected doctor and retrieves real availability.

**Patient:**

"Book the 10:30 slot."

Assistant shows a confirmation summary before booking.

**Doctor:**

"How many appointments do I have today?"

Assistant retrieves actual appointment statistics.

**Doctor:**

"Show my next available slot."

Assistant checks actual scheduling data and responds.

Maintain conversation context so follow-up messages can refer to previously selected doctors, appointments, dates, and slots.

However, never use conversational context as proof of authorization or confirmation.

---

## 11. Error Handling

Handle cases such as:

- No available appointment slots.
- Doctor not found.
- Invalid date or time.
- Slot taken by another patient.
- Appointment already cancelled.
- Appointment not eligible for rescheduling.
- Payment failure.
- Refund pending or failed.
- Expired confirmation.
- Unauthorized access.
- Network failure.
- Gemini API errors.
- Voice permission denied.
- Unsupported speech recognition.

Give clear, user-friendly responses and do not fabricate successful results.

---

## 12. Testing Requirements

Add or update tests for:

### Doctor functionality
- Today's appointments.
- Date-based appointments.
- Appointment statistics.
- Availability retrieval.
- Scheduling conflict detection.
- Next available slot.

### Patient functionality
- Upcoming and previous appointments.
- Doctor search.
- Slot retrieval.
- Alternative slot suggestions.
- Booking confirmation.
- Rescheduling confirmation.
- Cancellation confirmation.
- Payment and refund status.

### Security
- Patient cannot access another patient's appointments.
- Doctor cannot access another doctor's appointments.
- Patient cannot execute doctor-only tools.
- Doctor cannot execute patient-only tools.
- Confirmation cannot be reused.
- Expired confirmation is rejected.
- Slot availability is revalidated before booking.
- Duplicate booking or cancellation is prevented.

### UI and voice
- Floating chatbot on both portals.
- Responsive mobile and desktop UI.
- Text conversation.
- Voice input and output.
- Stop/interruption controls.
- Microphone permission handling.
- Graceful fallback when browser voice APIs are unavailable.

Use the existing testing framework and conventions.

---

## 13. Implementation Strategy

Implement in phases. Do not attempt to build everything in one uncontrolled change.

**Phase 1 — Foundation**
- Inspect the codebase.
- Configure Gemini API and Vercel AI SDK.
- Create authenticated chat API.
- Create reusable floating chatbot UI.
- Integrate it into doctor and patient portals.
- Implement role-aware system prompts and basic conversation.

**Phase 2 — Read-only operations**
- Doctor appointment queries and statistics.
- Doctor availability and scheduling queries.
- Patient appointment history.
- Doctor search.
- Patient available slot queries.

**Phase 3 — Patient operations**
- Booking.
- Rescheduling.
- Cancellation.
- Confirmation mechanism.
- Cashfree payment integration.
- Payment and refund status.

**Phase 4 — Doctor operations**
- Schedule previews.
- Schedule modifications.
- Conflict checks.
- Next available slot.
- Confirmation and execution through existing scheduling services.

**Phase 5 — Voice**
- Speech recognition.
- Text-to-speech.
- Continuous voice mode.
- Interruption and echo prevention.
- Language selection.

**Phase 6 — Testing and hardening**
- Security checks.
- Authorization tests.
- Error handling.
- Regression tests.
- Responsive UI verification.
- Performance and API cost review.

Prioritize a working, secure text chatbot before advanced voice functionality.

---

## 14. Important Development Rules

1. Work within the current Git branch. Do not switch branches or overwrite unrelated work.
2. Inspect existing code before making changes.
3. Reuse existing APIs, server actions, Prisma models, and services.
4. Do not duplicate appointment, scheduling, payment, cancellation, or refund logic.
5. Do not use mock data.
6. Do not introduce a multi-agent architecture.
7. Do not introduce a vector database or RAG unless a demonstrated requirement exists.
8. Keep Gemini API keys server-side.
9. All sensitive operations must require explicit confirmation.
10. Never let the AI model directly modify database records.
11. Preserve existing functionality.
12. Follow existing project coding standards.
13. Avoid unnecessary dependencies and large refactors.
14. Do not claim a feature is complete unless it has been implemented and tested.

---

## 15. Final Verification and Report

After implementation, run the available project checks:

```bash
npx prisma validate
npm run typecheck
npm test
npm run build
```

If a script does not exist, inspect `package.json` and use the appropriate existing command.

At the end, provide a clear report containing:

1. Features implemented.
2. Files created and modified.
3. Existing backend services reused.
4. Environment variables required.
5. Database migrations, if any.
6. API endpoints added.
7. Tests executed and their results.
8. Known limitations.
9. Features still pending.
10. Manual testing instructions.

**Final goal:** A single floating AI assistant available in both Medrella Doctor and Patient portals, capable of understanding natural conversations, retrieving real information, and performing authorized appointment and scheduling operations with secure confirmation. Voice interaction should work as a supported enhancement without compromising the core chatbot.
:::