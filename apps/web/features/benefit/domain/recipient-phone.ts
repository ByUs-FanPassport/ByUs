import { parsePhoneNumberFromString } from "libphonenumber-js";
import type { Country } from "react-phone-number-input";

export type NormalizedRecipientPhone = {
  country: Country;
  e164: string;
  last4: string;
};

export function normalizeRecipientPhone(
  country: Country,
  input: string,
): NormalizedRecipientPhone {
  const value = input.trim();
  const phone = parsePhoneNumberFromString(value, {
    defaultCountry: country,
    extract: false,
  });

  if (!phone || phone.ext || !phone.isValid() || phone.country !== country) {
    throw new Error("INVALID_RECIPIENT_PHONE");
  }

  const e164 = phone.number;
  return {
    country,
    e164,
    last4: e164.slice(-4),
  };
}
