/**
 * Converts empty/null/undefined strings to undefined for Radix UI Select.
 * Radix Select crashes ("removeChild") when value is an empty string
 * but no SelectItem has value="". Using undefined shows the placeholder instead.
 */
export const safeSelectValue = (value: string | null | undefined): string | undefined => {
  if (!value || value.trim() === '') return undefined;
  return value;
};
