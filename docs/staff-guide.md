# NGB Cargo Tracking: staff guide

This guide is for NGB staff using the tracking app, on staging during training and on production for the pilot. Each section is for one role. Read "Everyone" first.

> **Staging is for practice.** Every company, person, container and amount on staging is made up. Never enter real client data there.

## Everyone

**Signing in**
- You get a one-time invitation link from an administrator or operations manager. Open it, choose a password (at least 10 characters), and you're signed in.
- After that, sign in at `/login` with your work email.
- Forgot your password? Use "Forgot password?" on the sign-in page. If no email arrives within 10 minutes, ask an administrator for a new invitation link.
- Each person has their own account. **Never share a login**: everything you record is saved under your name and can't be edited later.

**On your phone**
- Open the site in Chrome (Android) or Safari (iPhone), then choose *Add to Home Screen*.
- On iPhone, notifications only work from the home-screen app (iOS 16.4 or later).
- If the connection drops, the app shows an offline page. Nothing you were typing is sent until you're back online and press the button again.

**What the menu shows depends on your role.** If a page says you are not allowed, your role doesn't cover it. Ask an operations manager.

**History cannot be changed.**
- Milestones, ETA changes, payments, exceptions and incidents are never overwritten.
- A mistake is fixed with a *correction*, which adds a new entry and keeps the original.
- Clients see the corrected result. Staff can see both.

## Operations manager

You see every shipment and run the daily flow.

**Overview** shows what needs attention: overdue milestones, open exceptions, missing documents and returns due.

**Shipments**
- *Register a shipment* (or the documentation officer does it): client, BL, origin port, destination, cargo and containers.
  - Container numbers are checked automatically (ISO 6346 check digit).
  - The same BL or container can't be on two open shipments.
- Shipment page: *Record a milestone*. Choose the step, the time it happened (not the time you're typing), the containers it applies to, and an optional note for the client.
- Steps must follow the normal order. To skip a step, you (or an admin) must give an override reason.
- **Gate-out needs customs released and a truck assigned.**
- *Update ETA* always asks for a reason.
  - Clients are notified only when the change matters: more than 2 hours if delivery is due within a day, otherwise more than 6 hours.
  - You can hide the real reason from the client. They then see "Schedule updated".

**Exceptions**
- An exception (delay, hold, damage, missing document) is a record with an owner, a next action and a follow-up time. The shipment keeps its status.
- The SLA check opens exceptions automatically when a step is overdue. *Run SLA check now* forces it.
- Resolve an exception with a short resolution note.

**Return, incidents, closing**
- Set the empty-return depot and deadline under *Save return terms*.
- Record the container condition at return. Damage needs a note and opens an incident. Only you or an admin resolve incidents.
- *Close* the shipment when the checklist is all green: proof of delivery, container returned, no open incidents or exceptions, and the invoice paid or credit approved by finance.
- Reopening needs a reason. Both actions are kept in the closure log.

**Notifications** (`/admin/notifications`)
- The panel at the top says whether messages are going out.
- "Messages are not going out" or "Sending is paused" means push or WhatsApp messages are waiting. **Milestones and the clients' in-app inbox are not affected.**
- Failed messages are listed. Use *Retry* for one message, or *Retry all* after an outage. Only retry what is still useful to the client.

**Users:** invite client users for any client company, and switch accounts off when someone leaves. Only an administrator invites NGB staff.

## Documentation officer

- Register shipments and keep the **Document checklist** complete.
- Upload documents on the shipment page (PDF, JPG, PNG, WebP or HEIC, up to 20 MB). *Client can see this document* is ticked by default; **untick it for internal papers**.
- Verify or reject documents, including the ones clients upload (a rejection needs a reason the client will read).
- A missing required document keeps the shipment at "awaiting documents".

## Clearing agent

- You see only the shipments assigned to you, and only their clients.
- Record the customs steps (entry in preparation, submitted, inspection, duties pending, released, on hold) and upload customs papers.
- "On hold" should come with an exception explaining why.

## Transport coordinator

- Assign a truck for the containers that are ready: registration, trailer, transporter, driver and planned loading time. This records "Truck assigned".
- *Cancel assignment* if the truck changes, then assign the new one.
- The driver's phone number is shown to the client only if both the client company and the driver allow it.

## Driver / transporter

- Open `/driver` on your phone. You see only the jobs on your truck, and only until the shipment is closed.
- Record loading, departure, border, arrival and delivery. Add a photo of the proof of delivery.
- Use *Report a problem* for breakdowns, delays or damage. The operations team is notified straight away.
- Your notes are for NGB only; clients don't see them.

## Finance officer

**Invoices** (Finance)
- Create a draft from the shipment, add lines (each with its own tax rate), and **Issue** it.
- Issuing gives the invoice its number (INV-YYYY-NNNNN). After that the invoice can't be edited.
- Mistakes after issue: issue a credit note. *Void* is possible only before any payment or credit.

**Payments**
- Record each payment as it arrives. Only **verified** payments count towards the balance.
- Verifying a payment creates the receipt (RCPT-…) and tells the client.
- A payment must be in the invoice's currency. Totals are never added across currencies.

**Reminders**
- Reminders go automatically, from 3 days before the due date up to 30 days after.
- Each stage is sent only once. Disputed invoices and companies with reminders switched off are skipped.
- *Send reminders now* runs them immediately.

**Closing on credit:** if a shipment must close before it's paid, approve the closure credit with a reason.

**Reports:** overdue invoices by age band, per client and currency.

## System administrator

- Everything the operations manager can do, plus:
  - inviting NGB staff;
  - settings;
  - the *Pause sending* switch on the Notifications page, for a provider incident.
- Messages keep queuing while sending is paused. Remember to resume.
- Roles are changed only by an administrator. A role change takes effect at once.

## Clients (what to tell them)

- Clients see their own company's shipments, documents marked visible, ETA and reason, invoices, payments and receipts, and their notification inbox. They never see another company or NGB's internal notes.
- They can upload documents NGB asks for. These are checked by the documentation officer.
- In *Settings* they turn on phone notifications and, if they want, WhatsApp. WhatsApp needs their consent and a number with the country code.

## If something goes wrong

| Problem | What to do |
|---|---|
| Can't sign in | Wait 5 minutes (too many attempts are blocked for a short time), then ask an admin for a new invitation link. |
| A step is refused ("not allowed" or "cannot … yet") | The message says what is missing, for example customs not released or POD missing. Fix that first; don't work around it. |
| Wrong milestone recorded | Correct it on the timeline with a reason. The original stays in the history. |
| Clients say they get no messages | Check the Notifications panel. The in-app inbox always has the update. |
| Anything that looks like another client's data | Stop and tell the system administrator immediately. |
