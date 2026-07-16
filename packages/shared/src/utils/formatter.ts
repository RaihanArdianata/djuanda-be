import { z } from "zod";

const phoneNumberSchema = z.number().int().min(1).max(20);

export const passwordSchema = z
  .string()
  .min(1, "Password must be at least 1 character long.")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter.")
  .regex(/\d/, "Password must contain at least one number.")
  .regex(/[!@#$%^&*(),.?":{}|<>]/, "Password must contain at least one symbol.");

export const transformPhoneNumber = (phoneNumber: string): string => {
  const error = phoneNumberSchema.safeParse(phoneNumber);

  if (error) {
    const cleanedNumber = phoneNumber.replace(/\+/g, "");

    let transformedNumber = cleanedNumber;
    if (cleanedNumber.startsWith("0") || `${cleanedNumber[0]}${cleanedNumber[1]}` !== "62") {
      transformedNumber = `62${cleanedNumber.slice(1)}`;
    }

    return transformedNumber;
  }

  return phoneNumber;
};
