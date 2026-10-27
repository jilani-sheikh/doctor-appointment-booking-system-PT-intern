import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import ws from "ws";
import { neonConfig } from "@neondatabase/serverless";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient, Role, DoctorStatus, SlotStatus } from "../src/generated/prisma/client";
import { createISTDate, getTomorrowIST } from "../src/lib/time";

// Standalone PrismaClient initialization for seeding (avoids importing server-only from src/lib/db)
neonConfig.webSocketConstructor = ws;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error(
    "\n[Medrella Seed Error] Missing DATABASE_URL environment variable.\n" +
    "Please ensure DATABASE_URL (Neon pooled connection) is configured in your .env.local file.\n"
  );
  process.exit(1);
}

// Production safety guard
const isProduction = process.env.NODE_ENV === "production";
const hasForceFlag = process.argv.includes("--force");

if (isProduction && !hasForceFlag) {
  console.error(
    "\n[Medrella Seed Error] Refusing to seed in PRODUCTION environment without explicit --force flag.\n" +
    "To proceed in production, run: npm run db:seed -- --force\n"
  );
  process.exit(1);
}

const adapter = new PrismaNeon({ connectionString });
const prisma = new PrismaClient({ adapter });

interface DemoDoctorConfig {
  name: string;
  email: string;
  specialization: string;
  qualification: string;
  consultationFee: number;
  experienceYears: number;
  bio: string;
}

const DEMO_DOCTORS: DemoDoctorConfig[] = [
  {
    name: "Dr. Ananya Deshmukh",
    email: "dr.ananya@demo.medrella.test",
    specialization: "Cardiology",
    qualification: "MBBS, MD (Cardiology)",
    consultationFee: 800,
    experienceYears: 12,
    bio: "Consultant cardiologist focusing on preventative cardiology, hypertension management, and lifestyle cardiovascular wellness.",
  },
  {
    name: "Dr. Rohan Kulkarni",
    email: "dr.rohan@demo.medrella.test",
    specialization: "General Physician",
    qualification: "MBBS",
    consultationFee: 400,
    experienceYears: 8,
    bio: "General physician providing comprehensive primary healthcare, seasonal illness management, and preventative health checks.",
  },
  {
    name: "Dr. Meera Iyer",
    email: "dr.meera@demo.medrella.test",
    specialization: "Dermatology",
    qualification: "MBBS, MD (Dermatology)",
    consultationFee: 600,
    experienceYears: 10,
    bio: "Clinical dermatologist experienced in skin wellness, acne management, and dermatological evaluations for adults and adolescents.",
  },
  {
    name: "Dr. Arjun Nair",
    email: "dr.arjun@demo.medrella.test",
    specialization: "Orthopedics",
    qualification: "MBBS, MS (Orthopedics)",
    consultationFee: 700,
    experienceYears: 14,
    bio: "Orthopedic surgeon specializing in joint mobility, sports injuries, and conservative management of musculoskeletal conditions.",
  },
  {
    name: "Dr. Sneha Patil",
    email: "dr.sneha@demo.medrella.test",
    specialization: "Pediatrics",
    qualification: "MBBS, DCH",
    consultationFee: 500,
    experienceYears: 9,
    bio: "Pediatrician providing newborn care, developmental milestone tracking, and routine childhood immunization consults.",
  },
  {
    name: "Dr. Imran Sheikh",
    email: "dr.imran@demo.medrella.test",
    specialization: "ENT",
    qualification: "MBBS, MS (ENT)",
    consultationFee: 550,
    experienceYears: 11,
    bio: "Ear, Nose, and Throat specialist addressing sinus health, hearing evaluations, and upper respiratory tract care.",
  },
  {
    name: "Dr. Kavita Rao",
    email: "dr.kavita@demo.medrella.test",
    specialization: "Gynecology",
    qualification: "MBBS, MD (Obs & Gyn)",
    consultationFee: 700,
    experienceYears: 15,
    bio: "Obstetrician and gynecologist committed to comprehensive women's health, routine screenings, and wellness guidance.",
  },
  {
    name: "Dr. Vikram Joshi",
    email: "dr.vikram@demo.medrella.test",
    specialization: "Neurology",
    qualification: "MBBS, DM (Neurology)",
    consultationFee: 1000,
    experienceYears: 16,
    bio: "Neurologist focusing on headaches, sleep disorders, and general clinical neurological diagnostics.",
  },
  {
    name: "Dr. Pooja Menon",
    email: "dr.pooja@demo.medrella.test",
    specialization: "Dentistry",
    qualification: "BDS, MDS",
    consultationFee: 450,
    experienceYears: 7,
    bio: "Dental surgeon providing oral health consultations, preventative cleanings, and restorative dental guidance.",
  },
];

async function main() {
  console.log("=========================================");
  console.log("  Medrella Demo Seed: Starting Execution");
  console.log("=========================================");

  let totalDoctorsCreated = 0;
  let totalSlotsCreated = 0;

  // 1. Seed Demo Doctors (Idempotent upsert by email)
  for (const doc of DEMO_DOCTORS) {
    const user = await prisma.user.upsert({
      where: { email: doc.email },
      update: {
        name: doc.name,
        role: Role.DOCTOR,
      },
      create: {
        name: doc.name,
        email: doc.email,
        role: Role.DOCTOR,
        passwordHash: null, // Demo accounts have no password and cannot sign in
      },
    });

    const doctor = await prisma.doctor.upsert({
      where: { userId: user.id },
      update: {
        specialization: doc.specialization,
        qualification: doc.qualification,
        consultationFee: doc.consultationFee,
        experienceYears: doc.experienceYears,
        bio: doc.bio,
        status: DoctorStatus.APPROVED,
        isDemo: true,
      },
      create: {
        userId: user.id,
        specialization: doc.specialization,
        qualification: doc.qualification,
        consultationFee: doc.consultationFee,
        experienceYears: doc.experienceYears,
        bio: doc.bio,
        status: DoctorStatus.APPROVED,
        isDemo: true,
      },
    });

    totalDoctorsCreated++;

    // 2. Generate 30-minute slots for the next 14 days (Mon-Sat, 10:00-13:00 and 16:00-19:00 IST)
    // Starting strictly from TOMORROW
    const tomorrow = getTomorrowIST();
    const currentDate = new Date(Date.UTC(tomorrow.year, tomorrow.month - 1, tomorrow.day));

    for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
      const iterDate = new Date(currentDate.getTime() + dayOffset * 24 * 60 * 60 * 1000);
      const dayOfWeek = iterDate.getUTCDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat

      // Skip Sunday (clinics closed)
      if (dayOfWeek === 0) continue;

      const year = iterDate.getUTCFullYear();
      const month = iterDate.getUTCMonth() + 1;
      const day = iterDate.getUTCDate();

      // Morning Slots: 10:00 - 13:00 IST (6 slots: 10:00, 10:30, 11:00, 11:30, 12:00, 12:30)
      const morningStarts = [
        [10, 0],
        [10, 30],
        [11, 0],
        [11, 30],
        [12, 0],
        [12, 30],
      ];

      // Evening Slots: 16:00 - 19:00 IST (6 slots: 16:00, 16:30, 17:00, 17:30, 18:00, 18:30)
      const eveningStarts = [
        [16, 0],
        [16, 30],
        [17, 0],
        [17, 30],
        [18, 0],
        [18, 30],
      ];

      const allSlotStarts = [...morningStarts, ...eveningStarts];

      for (let sIdx = 0; sIdx < allSlotStarts.length; sIdx++) {
        const [h, m] = allSlotStarts[sIdx];
        const startTime = createISTDate(year, month, day, h, m);
        const endTime = new Date(startTime.getTime() + 30 * 60 * 1000); // +30 minutes

        // Selectively mark a few slots as BLOCKED for demo variety
        let status: SlotStatus = SlotStatus.AVAILABLE;
        if (dayOfWeek === 3 && h === 16 && m === 0) {
          status = SlotStatus.BLOCKED;
        } else if (dayOfWeek === 5 && h === 12 && m === 0) {
          status = SlotStatus.BLOCKED;
        }

        await prisma.availability.upsert({
          where: {
            doctorId_startTime: {
              doctorId: doctor.id,
              startTime,
            },
          },
          update: {
            endTime,
            status,
          },
          create: {
            doctorId: doctor.id,
            startTime,
            endTime,
            status,
          },
        });

        totalSlotsCreated++;
      }
    }
  }

  console.log(`\n✔ Successfully seeded:`);
  console.log(`  - ${totalDoctorsCreated} demo doctors (all APPROVED, role DOCTOR, isDemo: true)`);
  console.log(`  - ${totalSlotsCreated} availability slots (14-day schedule starting tomorrow, Mon-Sat)`);
  console.log("\nDemo cleanup query (if needed in development):");
  console.log('  DELETE FROM users WHERE id IN (SELECT user_id FROM doctors WHERE is_demo = true);');
  console.log("=========================================\n");
}

main()
  .catch((e) => {
    console.error("\n[Medrella Seed Execution Error]:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
