"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { completeOnboardingAction } from "@/lib/actions/auth";
import { SPECIALIZATIONS, GENDERS } from "@/lib/validations/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { User, Stethoscope, ArrowRight, ArrowLeft, CheckCircle2, AlertCircle } from "lucide-react";

interface OnboardingFlowProps {
  userName?: string | null;
}

export function OnboardingFlow({ userName }: OnboardingFlowProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Step 1: Role selection ("PATIENT" | "DOCTOR" | null)
  const [selectedRole, setSelectedRole] = useState<"PATIENT" | "DOCTOR" | null>(null);

  // Patient Form State
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [gender, setGender] = useState<string>("Prefer not to say");
  const [phone, setPhone] = useState("");
  const [whatsappOptIn, setWhatsappOptIn] = useState(false);

  // Doctor Form State
  const [specialization, setSpecialization] = useState<string>(SPECIALIZATIONS[0]);
  const [qualification, setQualification] = useState("");
  const [consultationFee, setConsultationFee] = useState<string>("500");
  const [experienceYears, setExperienceYears] = useState<string>("5");
  const [bio, setBio] = useState("");

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const validatePatient = () => {
    const errors: Record<string, string> = {};
    if (!dateOfBirth) {
      errors.dateOfBirth = "Date of birth is required";
    } else {
      const d = new Date(dateOfBirth);
      if (isNaN(d.getTime()) || d > new Date()) {
        errors.dateOfBirth = "Date of birth cannot be in the future";
      }
    }

    if (!phone.trim()) {
      errors.phone = "Phone number is required";
    } else if (!/^(?:\+91\s?|91\s?|0)?[6-9]\d{9}$/.test(phone.trim())) {
      errors.phone = "Please enter a valid 10-digit Indian phone number";
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const validateDoctor = () => {
    const errors: Record<string, string> = {};
    if (!qualification.trim()) {
      errors.qualification = "Qualification is required (e.g. MBBS, MD)";
    }

    const fee = Number(consultationFee);
    if (isNaN(fee) || fee <= 0) {
      errors.consultationFee = "Consultation fee must be greater than ₹0";
    } else if (fee > 50000) {
      errors.consultationFee = "Consultation fee cannot exceed ₹50,000";
    }

    const exp = Number(experienceYears);
    if (isNaN(exp) || exp < 0) {
      errors.experienceYears = "Experience cannot be negative";
    } else if (exp > 70) {
      errors.experienceYears = "Please enter a valid number of years";
    }

    if (bio.length > 1000) {
      errors.bio = "Bio cannot exceed 1,000 characters";
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!selectedRole) {
      setErrorMessage("Please select whether you are a Patient or a Doctor");
      return;
    }

    if (selectedRole === "PATIENT") {
      if (!validatePatient()) return;
      startTransition(async () => {
        const res = await completeOnboardingAction({
          role: "PATIENT",
          dateOfBirth,
          gender: gender as (typeof GENDERS)[number],
          phone: phone.trim(),
          whatsappOptIn,
        });

        if (!res.success) {
          setErrorMessage(res.error || "Failed to complete onboarding.");
          if (res.redirectUrl) {
            setTimeout(() => {
              router.refresh();
              router.push(res.redirectUrl!);
            }, 1500);
          }
        } else {
          router.refresh();
          router.push(res.redirectUrl || "/patient/dashboard");
        }
      });
    } else if (selectedRole === "DOCTOR") {
      if (!validateDoctor()) return;
      startTransition(async () => {
        const res = await completeOnboardingAction({
          role: "DOCTOR",
          specialization: specialization as (typeof SPECIALIZATIONS)[number],
          qualification: qualification.trim(),
          consultationFee: Number(consultationFee),
          experienceYears: Number(experienceYears),
          bio: bio.trim(),
        });

        if (!res.success) {
          setErrorMessage(res.error || "Failed to complete onboarding.");
          if (res.redirectUrl) {
            setTimeout(() => {
              router.refresh();
              router.push(res.redirectUrl!);
            }, 1500);
          }
        } else {
          router.refresh();
          router.push(res.redirectUrl || "/doctor/dashboard");
        }
      });
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto space-y-6">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Welcome to Medrella{userName ? `, ${userName}` : ""}!
        </h1>
        <p className="text-muted-foreground text-sm max-w-md mx-auto">
          Complete your profile in two quick steps to personalize your appointment scheduling experience.
        </p>
      </div>

      {errorMessage && (
        <div className="flex items-start gap-2.5 p-3.5 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <p className="leading-snug">{errorMessage}</p>
        </div>
      )}

      {/* Step 1: Role Choice */}
      {!selectedRole ? (
        <Card className="shadow-sm border-border bg-card">
          <CardHeader className="text-center">
            <CardTitle className="text-xl">Step 1: Choose Your Account Type</CardTitle>
            <CardDescription>
              Are you scheduling consultations for yourself, or are you a medical doctor?
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            <button
              type="button"
              onClick={() => setSelectedRole("PATIENT")}
              className="flex flex-col items-center justify-center p-6 rounded-xl border-2 border-border hover:border-primary/60 hover:bg-primary/5 transition-all text-center space-y-3 cursor-pointer group"
            >
              <div className="h-14 w-14 rounded-full bg-primary/10 text-primary flex items-center justify-center group-hover:scale-105 transition-transform">
                <User className="h-7 w-7" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground text-lg">I am a Patient</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Book doctor appointments, view consultations, and manage health records.
                </p>
              </div>
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary pt-2">
                Select Patient <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </button>

            <button
              type="button"
              onClick={() => setSelectedRole("DOCTOR")}
              className="flex flex-col items-center justify-center p-6 rounded-xl border-2 border-border hover:border-primary/60 hover:bg-primary/5 transition-all text-center space-y-3 cursor-pointer group"
            >
              <div className="h-14 w-14 rounded-full bg-primary/10 text-primary flex items-center justify-center group-hover:scale-105 transition-transform">
                <Stethoscope className="h-7 w-7" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground text-lg">I am a Doctor</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Set consultation hours, manage availability slots, and consult with patients.
                </p>
              </div>
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary pt-2">
                Select Doctor <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </button>
          </CardContent>
        </Card>
      ) : (
        /* Step 2: Role-Specific Form */
        <Card className="shadow-sm border-border bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-4 border-b border-border">
            <div>
              <CardTitle className="text-xl">
                Step 2: Complete Your {selectedRole === "PATIENT" ? "Patient" : "Doctor"} Profile
              </CardTitle>
              <CardDescription>
                {selectedRole === "PATIENT"
                  ? "Provide basic details for appointment bookings"
                  : "Fill in your professional medical details (subject to admin approval)"}
              </CardDescription>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setSelectedRole(null);
                setFieldErrors({});
                setErrorMessage(null);
              }}
              disabled={isPending}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Change Role
            </Button>
          </CardHeader>
          <CardContent className="pt-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              {selectedRole === "PATIENT" && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-sm font-medium text-foreground">Date of Birth</label>
                      <input
                        type="date"
                        value={dateOfBirth}
                        max={new Date().toISOString().split("T")[0]}
                        onChange={(e) => setDateOfBirth(e.target.value)}
                        disabled={isPending}
                        className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary disabled:opacity-50"
                      />
                      {fieldErrors.dateOfBirth && (
                        <p className="text-xs text-destructive mt-1">{fieldErrors.dateOfBirth}</p>
                      )}
                    </div>

                    <div className="space-y-1">
                      <label className="text-sm font-medium text-foreground">Gender</label>
                      <select
                        value={gender}
                        onChange={(e) => setGender(e.target.value)}
                        disabled={isPending}
                        className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary disabled:opacity-50"
                      >
                        {GENDERS.map((g) => (
                          <option key={g} value={g}>
                            {g}
                          </option>
                        ))}
                      </select>
                      {fieldErrors.gender && (
                        <p className="text-xs text-destructive mt-1">{fieldErrors.gender}</p>
                      )}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-sm font-medium text-foreground">Phone Number</label>
                    <input
                      type="tel"
                      placeholder="e.g. 9876543210"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      disabled={isPending}
                      className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary disabled:opacity-50"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Used for appointment updates and reminders.
                    </p>
                    <label className="flex items-start gap-2 pt-2 text-sm text-foreground">
                      <input
                        type="checkbox"
                        checked={whatsappOptIn}
                        onChange={(e) => setWhatsappOptIn(e.target.checked)}
                        disabled={isPending}
                        className="mt-1"
                      />
                      <span>Send me appointment updates on WhatsApp (to this phone number)</span>
                    </label>
                    {fieldErrors.phone && (
                      <p className="text-xs text-destructive mt-1">{fieldErrors.phone}</p>
                    )}
                  </div>
                </>
              )}

              {selectedRole === "DOCTOR" && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-sm font-medium text-foreground">Specialization</label>
                      <select
                        value={specialization}
                        onChange={(e) => setSpecialization(e.target.value)}
                        disabled={isPending}
                        className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary disabled:opacity-50"
                      >
                        {SPECIALIZATIONS.map((spec) => (
                          <option key={spec} value={spec}>
                            {spec}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="text-sm font-medium text-foreground">Qualification</label>
                      <input
                        type="text"
                        placeholder="e.g. MBBS, MD (Cardiology)"
                        value={qualification}
                        onChange={(e) => setQualification(e.target.value)}
                        disabled={isPending}
                        className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary disabled:opacity-50"
                      />
                      {fieldErrors.qualification && (
                        <p className="text-xs text-destructive mt-1">{fieldErrors.qualification}</p>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-sm font-medium text-foreground">
                        Consultation Fee (₹ INR)
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="50000"
                        value={consultationFee}
                        onChange={(e) => setConsultationFee(e.target.value)}
                        disabled={isPending}
                        className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary disabled:opacity-50"
                      />
                      {fieldErrors.consultationFee && (
                        <p className="text-xs text-destructive mt-1">{fieldErrors.consultationFee}</p>
                      )}
                    </div>

                    <div className="space-y-1">
                      <label className="text-sm font-medium text-foreground">
                        Experience (Years)
                      </label>
                      <input
                        type="number"
                        min="0"
                        max="70"
                        value={experienceYears}
                        onChange={(e) => setExperienceYears(e.target.value)}
                        disabled={isPending}
                        className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary disabled:opacity-50"
                      />
                      {fieldErrors.experienceYears && (
                        <p className="text-xs text-destructive mt-1">{fieldErrors.experienceYears}</p>
                      )}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-sm font-medium text-foreground">
                      Professional Bio (Optional)
                    </label>
                    <textarea
                      rows={3}
                      placeholder="Brief overview of clinical focus and background..."
                      value={bio}
                      onChange={(e) => setBio(e.target.value)}
                      disabled={isPending}
                      className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary disabled:opacity-50"
                    />
                    {fieldErrors.bio && (
                      <p className="text-xs text-destructive mt-1">{fieldErrors.bio}</p>
                    )}
                  </div>
                </>
              )}

              <div className="pt-4 border-t border-border flex items-center justify-end gap-3">
                <Button
                  type="submit"
                  disabled={isPending}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold px-6 shadow-sm"
                >
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  {isPending ? "Saving Profile..." : "Complete Onboarding"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
