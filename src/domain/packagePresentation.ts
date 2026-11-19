import { formatMoney } from "./finance";
import type { PackageDefinition } from "./model";

type PackageBenefitDefinition = Pick<
  PackageDefinition,
  | "benefitText"
  | "currency"
  | "discountBasisPoints"
  | "discountMinor"
  | "discountType"
  | "expirationDays"
  | "recurringEligible"
>;

export function learnerPackageText(text: string) {
  return text
    .replace(/\b(?:lesson )?credits\b/gi, "lessons")
    .replace(/\blesson credit\b/gi, "lesson");
}

export function packageBenefitLines(
  definition: PackageBenefitDefinition,
  learnerView = false,
) {
  const benefits: string[] = [];
  if (
    definition.discountType === "percent" &&
    Number(definition.discountBasisPoints) > 0
  ) {
    benefits.push(
      `${Number(definition.discountBasisPoints) / 100}% package discount`,
    );
  } else if (Number(definition.discountMinor) > 0) {
    benefits.push(
      `${formatMoney(definition.discountMinor, definition.currency)} package discount`,
    );
  }
  if (definition.expirationDays)
    benefits.push(`Use within ${definition.expirationDays} days`);
  if (definition.recurringEligible)
    benefits.push("Eligible for recurring scheduling");
  if (definition.benefitText?.trim())
    benefits.push(
      learnerView
        ? learnerPackageText(definition.benefitText.trim())
        : definition.benefitText.trim(),
    );
  return benefits.length ? benefits : ["Multi-session bundle"];
}
