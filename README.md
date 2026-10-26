# Doctor Appointment Booking System

A full-stack web application designed to simplify doctor appointment scheduling by connecting patients with doctors, managing doctor availability, and facilitating appointment bookings.

This project is being developed as part of the PearlThoughts internship programme.

## 📌 Project Overview

The Doctor Appointment Booking System aims to provide a structured platform for managing users, patient profiles, doctor profiles, doctor availability, and appointments.

The application will support role-based access for patients and doctors, allowing patients to explore doctors and book available appointment slots while enabling doctors to manage their availability and appointments.

The project will be developed incrementally, following a modular architecture and RESTful API principles.

## 🎯 Objectives

- Implement user registration, authentication, and role-based access.
- Maintain patient and doctor profiles.
- Allow doctors to manage their availability.
- Enable patients to book appointments using available time slots.
- Prevent conflicting bookings and duplicate reservations.
- Maintain appointment statuses and support appointment lifecycle management.
- Design a structured, relational PostgreSQL database.
- Build maintainable, modular backend APIs using NestJS and TypeScript.

## 🛠️ Technology Stack

| Technology | Purpose |
|---|---|
| Next.js | Frontend development and user interface |
| TypeScript | Type safety and maintainable application code |
| Node.js | JavaScript runtime for server-side execution |
| NestJS | Modular backend application and REST API development |
| PostgreSQL | Relational database for persistent application data |

The frontend and backend will be developed as separate application layers, communicating through HTTP APIs.

## 🧩 Planned Modules

Development will follow the module sequence defined for the project.

### 1. User Module
- Manage common user information.
- Support user registration and authentication.
- Maintain user roles, such as patient and doctor.
- Provide the foundation for role-based access control.

### 2. Patient Module
- Maintain patient profiles linked to user accounts.
- Store relevant patient information.
- Support patient profile creation and updates.

### 3. Doctor Module
- Maintain doctor profiles linked to user accounts.
- Store professional information, including specialisation and qualifications.
- Manage doctor profile information.

### 4. Availability Module
- Allow doctors to define their available appointment slots.
- Retrieve available slots for a doctor.
- Track slot availability and booking status.
- Prevent a slot from being booked by multiple patients.

### 5. Appointment Module
- Allow patients to book available appointment slots.
- Associate appointments with patients and availability slots.
- Maintain appointment statuses.
- Support appointment management, including cancellation and rescheduling, according to the final requirements.

## 🗄️ Database Design

PostgreSQL will be used as the relational database.

The initial database design defines the relationships between users, patients, doctors, availability slots, and appointments.

### Entity-Relationship Diagram

The ER diagram is available in PNG format:

![Doctor Appointment Booking System ER Diagram](docs/Doctor%20Appointment%20Booking%20System.png)

### Editable ER Diagram Source

The editable DBML source is available here:

[View the DBML source](docs/doctor-appointment-booking-system.dbml)

### Planned Entities

| Entity | Purpose |
|---|---|
| `users` | Stores common user information and account roles |
| `patients` | Stores patient-specific profile information |
| `doctors` | Stores doctor-specific professional information |
| `availabilities` | Stores doctors' available appointment slots |
| `appointments` | Stores appointment records and their statuses |

The initial schema establishes relationships between users and their corresponding patient or doctor profiles. It also associates availability slots with doctors and appointments with patients and availability slots.

Database constraints and application-level validations will be implemented to maintain data integrity and prevent conflicting bookings.

**Note:** The ER diagram and DBML file represent the initial database design. The schema may be refined as implementation requirements become clearer.

## 🏗️ Application Architecture

The application will use a frontend-backend architecture.

```text
                 Patient / Doctor
                        |
                        v
                 Next.js Frontend
                        |
                   HTTP / REST
                        |
                        v
                 NestJS Backend
                        |
             ----------------------
             |         |          |
             v         v          v
           User     Patient     Doctor
             Module   Module     Module
                        |
                 Availability Module
                        |
                  Appointment Module
                        |
                        v
                  PostgreSQL
```

NestJS modules will separate application responsibilities and help keep the backend maintainable as the project grows.

The final module structure and database integration will be established during implementation.

## 📂 Initial Repository Structure

```text
doctor-appointment-booking-system-PT-intern/
├── docs/
│   ├── Doctor Appointment Booking System.png
│   └── doctor-appointment-booking-system.dbml
├── README.md
└── ...
```

The repository currently contains the initial database design documentation. Frontend and backend source code will be added as development progresses.

## 🚀 Development Roadmap

The planned development sequence is:

1. **Project Setup:** Initialise the frontend and backend projects and establish the development environment.
2. **User Module:** Implement user management, authentication, and roles.
3. **Patient Module:** Implement patient profiles and related APIs.
4. **Doctor Module:** Implement doctor profiles and related APIs.
5. **Availability Module:** Implement doctor availability and slot management.
6. **Appointment Module:** Implement booking and appointment lifecycle management.
7. **Integration and Testing:** Integrate the modules, validate API behaviour, and test database constraints.
8. **Documentation:** Maintain setup instructions and document the implemented functionality.

The roadmap may be adjusted to match the programme's detailed weekly plan and mentor feedback.

## 📋 Current Status

- [x] Initial ER diagram created.
- [x] Editable DBML source added.
- [x] Initial database entities and relationships documented.
- [x] Project repository created.
- [ ] Frontend project setup.
- [ ] NestJS backend setup.
- [ ] PostgreSQL database configuration.
- [ ] User module implementation.
- [ ] Patient module implementation.
- [ ] Doctor module implementation.
- [ ] Availability module implementation.
- [ ] Appointment module implementation.
- [ ] API integration and testing.

## 🤝 Development Workflow

The project will use Git and GitHub for version control.

- `main` will serve as the primary branch.
- Feature branches will be used for individual changes.
- Pull Requests will be used to review and document proposed changes before merging, following the applicable repository and internship guidelines.

## 📄 Project Scope

This README documents the initial design and planned functionality. Features listed as planned are not considered implemented until their code and tests are completed.

The final implementation will follow the requirements and feedback provided during the internship programme.