# Smart Computer Maintenance Service — MongoDB Schema

**Database:** `ict_maintenance_db`
**Connection:** MongoDB Atlas (configured in `.env`)

---

## Collections Overview

| Collection            | Model               | Description                          |
|-----------------------|---------------------|--------------------------------------|
| `users`               | User                | All system users (admin/tech/staff)  |
| `technicians`         | Technician          | Technician profiles linked to users  |
| `categories`          | Category            | Maintenance request categories       |
| `ictassets`           | ICTAsset            | Inventory of ICT equipment           |
| `tickets`             | Ticket              | Maintenance tickets (core model)     |
| `assignments`         | Assignment          | Technician-to-ticket assignments     |
| `maintenancerecords`  | MaintenanceRecord   | Work logs per ticket                 |
| `feedbacks`           | Feedback            | User ratings after resolution        |
| `notifications`       | Notification        | In-app notifications per user        |
| `inquiries`           | Inquiry             | Public contact/support inquiries     |
| `counters`            | Counter             | Auto-increment counters              |

---

## 1. users

| Field        | Type     | Required | Notes                                             |
|--------------|----------|----------|----------------------------------------------------|
| `_id`        | ObjectId | auto     | MongoDB primary key                                |
| `fullName`   | String   | yes      | Full name                                          |
| `email`      | String   | yes      | Unique, lowercase                                  |
| `phone`      | String   | no       |                                                    |
| `department` | String   | no       | e.g. Finance, Human Resources                      |
| `password`   | String   | yes      | bcrypt hashed (12 rounds)                          |
| `role`       | String   | yes      | `Requester` \| `Technician` \| `ICT Admin` (default: Requester) |
| `status`     | String   | yes      | `active` \| `inactive` (default: active)           |
| `createdAt`  | Date     | auto     |                                                    |
| `updatedAt`  | Date     | auto     |                                                    |

**Notes:**
- `Requester` is the standard role for staff who submit maintenance requests.
- `Technician` and `ICT Admin` roles are only created via admin user management.

---

## 2. technicians

| Field            | Type     | Required | Notes                          |
|------------------|----------|----------|--------------------------------|
| `_id`            | ObjectId | auto     |                                |
| `user`           | ObjectId | yes      | ref → users._id (unique)       |
| `specialization` | String   | no       | e.g. Hardware Repair & Desktop |
| `available`      | Boolean  | yes      | default: true                  |
| `createdAt`      | Date     | auto     |                                |
| `updatedAt`      | Date     | auto     |                                |

---

## 3. categories

| Field         | Type     | Required | Notes          |
|---------------|----------|----------|----------------|
| `_id`         | ObjectId | auto     |                |
| `name`        | String   | yes      | Unique         |
| `description` | String   | no       |                |
| `createdAt`   | Date     | auto     |                |
| `updatedAt`   | Date     | auto     |                |

---

## 4. ictassets

| Field            | Type     | Required | Notes                                              |
|------------------|----------|----------|----------------------------------------------------|
| `_id`            | ObjectId | auto     |                                                    |
| `asset_name`     | String   | yes      | e.g. Dell Latitude 5520                            |
| `asset_tag`      | String   | yes      | Unique tag, e.g. ICT-001                           |
| `category`       | String   | no       | Laptop, Printer, Desktop, Monitor                  |
| `department`     | String   | no       |                                                    |
| `location`       | String   | no       | Room/building                                      |
| `status`         | String   | yes      | `active` \| `under_maintenance` \| `decommissioned`|
| `purchase_date`  | Date     | no       |                                                    |
| `warranty_expiry`| Date     | no       |                                                    |
| `description`    | String   | no       |                                                    |
| `createdAt`      | Date     | auto     |                                                    |
| `updatedAt`      | Date     | auto     |                                                    |

---

## 5. tickets

| Field               | Type     | Required | Notes                                                             |
|---------------------|----------|----------|-------------------------------------------------------------------|
| `_id`               | ObjectId | auto     |                                                                   |
| `ticketId`          | String   | yes      | Auto-generated: TK-0001, TK-0002, etc.                            |
| `requester`         | ObjectId | yes      | ref → users._id                                                   |
| `department`        | String   | no       | Copied from user at creation                                      |
| `phone`             | String   | no       |                                                                   |
| `title`             | String   | no       | Optional short title                                              |
| `equipmentType`     | String   | no       | Desktop Computer, Laptop, Printer, Scanner, Monitor, Projector, UPS/Power Supply, Keyboard/Mouse, Other |
| `category`          | String   | no       | Free-text category                                                |
| `serialNumber`      | String   | no       |                                                                   |
| `officeBlock`       | String   | no       | Location                                                          |
| `problemDescription`| String   | yes      | Detailed problem description                                      |
| `priority`          | String   | yes      | `low` \| `medium` \| `high` \| `critical` (default: medium)      |
| `status`            | String   | yes      | `submitted` \| `under_review` \| `assigned` \| `accepted` \| `in_progress` \| `resolved` \| `closed` |
| `assignedTechnician`| ObjectId | no       | ref → users._id                                                   |
| `identifiedProblem` | String   | no       | Technician's diagnosis                                            |
| `resolutionResponse`| String   | no       | Resolution details                                                |
| `isFixed`           | Boolean  | no       | default: false                                                    |
| `reasonIfNotFixed`  | String   | no       | Reason when not fixed                                             |
| `feedbackRating`    | Number   | no       | 1–5 stars                                                         |
| `feedbackComments`  | String   | no       |                                                                   |
| `attachment`        | String   | no       | Filename in uploads/                                              |
| `createdAt`         | Date     | auto     |                                                                   |
| `updatedAt`         | Date     | auto     |                                                                   |

### Status Lifecycle

```
submitted → under_review → assigned → accepted → in_progress → resolved → closed
```

---

## 6. assignments

| Field         | Type     | Required | Notes                                                       |
|---------------|----------|----------|-------------------------------------------------------------|
| `_id`         | ObjectId | auto     |                                                             |
| `ticket`      | ObjectId | yes      | ref → tickets._id                                           |
| `technician`  | ObjectId | yes      | ref → technicians._id                                       |
| `assigned_by` | ObjectId | no       | ref → users._id (admin who assigned)                        |
| `notes`       | String   | no       | Instructions                                                |
| `status`      | String   | yes      | `assigned` \| `accepted` \| `in_progress` \| `completed` \| `reassigned` |
| `createdAt`   | Date     | auto     |                                                             |
| `updatedAt`   | Date     | auto     |                                                             |

---

## 7. maintenancerecords

| Field          | Type     | Required | Notes                                        |
|----------------|----------|----------|----------------------------------------------|
| `_id`          | ObjectId | auto     |                                              |
| `request`      | ObjectId | yes      | ref → tickets._id                            |
| `technician`   | ObjectId | yes      | ref → technicians._id                        |
| `action_taken` | String   | yes      | Description of work done                     |
| `parts_used`   | String   | no       | e.g. RAM 8GB, HDMI Cable                     |
| `notes`        | String   | no       | Additional notes                             |
| `status`       | String   | yes      | `accepted` \| `in_progress` \| `resolved`   |
| `createdAt`    | Date     | auto     |                                              |
| `updatedAt`    | Date     | auto     |                                              |

---

## 8. feedbacks

| Field      | Type     | Required | Notes                              |
|------------|----------|----------|------------------------------------|
| `_id`      | ObjectId | auto     |                                    |
| `request`  | ObjectId | yes      | ref → tickets._id (unique per request) |
| `user`     | ObjectId | yes      | ref → users._id (who gave feedback)|
| `rating`   | Number   | yes      | 1–5 stars                          |
| `comment`  | String   | no       |                                    |
| `createdAt`| Date     | auto     |                                    |
| `updatedAt`| Date     | auto     |                                    |

---

## 9. notifications

| Field      | Type     | Required | Notes                                      |
|------------|----------|----------|--------------------------------------------|
| `_id`      | ObjectId | auto     |                                            |
| `user`     | ObjectId | yes      | ref → users._id (recipient)               |
| `title`    | String   | yes      |                                            |
| `message`  | String   | yes      |                                            |
| `type`     | String   | yes      | `info` \| `success` \| `warning` \| `danger` |
| `is_read`  | Boolean  | yes      | default: false                             |
| `createdAt`| Date     | auto     |                                            |
| `updatedAt`| Date     | auto     |                                            |

---

## 10. inquiries

| Field         | Type     | Required | Notes                                              |
|---------------|----------|----------|----------------------------------------------------|
| `_id`         | ObjectId | auto     |                                                    |
| `fullName`    | String   | yes      | Submitter's full name                              |
| `email`       | String   | yes      | Lowercase                                          |
| `department`  | String   | no       |                                                    |
| `issueType`   | String   | yes      | Hardware Problem, Software Problem, Network Problem, Printer Problem, Account/Access Problem, ICT Service Request, Other |
| `description` | String   | yes      | Detailed description                               |
| `status`      | String   | yes      | `pending` \| `in_progress` \| `resolved` (default: pending) |
| `createdAt`   | Date     | auto     |                                                    |
| `updatedAt`   | Date     | auto     |                                                    |

---

## 11. counters

| Field | Type   | Required | Notes                           |
|-------|--------|----------|---------------------------------|
| `_id` | String | yes      | Counter name (e.g. "ticketId") |
| `seq` | Number | yes      | Current sequence value          |

---

## Relationships Diagram

```
users ──────────────────┐
  │                     │
  ├── technicians        │  (user → users._id)
  │     │               │
  │     ├── assignments  │  (technician → technicians._id)
  │     └── maintenancerecords
  │
  ├── tickets            │  (requester → users._id)
  │     │
  │     ├── assignments  │  (ticket → tickets._id)
  │     ├── maintenancerecords
  │     └── feedbacks
  │
  ├── notifications      │  (user → users._id)
  │
  └── inquiries (standalone)

categories ──── (free-text in tickets.category)
ictassets  ──── (free-text in tickets.equipmentType / serialNumber)
```

---

## Default Seed Accounts

| Role      | Email                    | Password   |
|-----------|--------------------------|------------|
| ICT Admin | admin@ict.local          | Admin@1234 |
| Technician| tech1@ict.local          | Tech@1234  |
| Technician| tech2@ict.local          | Tech@1234  |
| Technician| tech3@ict.local          | Tech@1234  |
| Requester | staff1@ict.local         | Staff@1234 |
| Requester | staff2@ict.local         | Staff@1234 |
| Requester | staff3@ict.local         | Staff@1234 |

**Additional dev accounts** (created by `resetUsers.js`):
| Role      | Email                    | Password    |
|-----------|--------------------------|-------------|
| ICT Admin | admin@dbu.edu.et         | Admin123!   |
| Technician| technician@dbu.edu.et    | Tech123!    |
