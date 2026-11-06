'use client';

import { Input, Select, Textarea, Field } from '@/components/ui/form';

/**
 * Indian address form with real, honest validation.
 *
 * Rules encoded here are the ones India Post / major couriers actually apply:
 *   - postal code is exactly 6 digits and the first digit is 1–9
 *   - mobile number is 10 digits starting 6–9 (the current Indian numbering)
 *   - state is chosen from a fixed list rather than free text, so the
 *     shipping calculator downstream never has to fuzzy-match
 *
 * Validation runs on submit and re-runs on change for the touched fields
 * only, so the customer is never scolded for a field they have not reached.
 */

export const INDIAN_STATES = [
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chhattisgarh',
  'Delhi',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Puducherry',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
] as const;

export interface AddressDraft {
  label: string;
  fullName: string;
  phone: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
}

export const EMPTY_ADDRESS: AddressDraft = {
  label: 'Home',
  fullName: '',
  phone: '',
  line1: '',
  line2: '',
  city: '',
  state: '',
  postalCode: '',
};

export type AddressErrors = Partial<Record<keyof AddressDraft, string>>;

/** Returns a map of field -> message. An empty object means valid. */
export function validateAddress(draft: AddressDraft): AddressErrors {
  const errors: AddressErrors = {};

  if (draft.fullName.trim().length < 2) {
    errors.fullName = 'Enter the recipient’s full name.';
  }
  const digits = draft.phone.replace(/\D/g, '');
  if (!/^[6-9]\d{9}$/.test(digits)) {
    errors.phone = 'Enter a 10-digit Indian mobile number starting 6–9.';
  }
  if (draft.line1.trim().length < 5) {
    errors.line1 = 'Enter the house number and street.';
  }
  if (draft.city.trim().length < 2) {
    errors.city = 'Enter the city.';
  }
  if (!draft.state) {
    errors.state = 'Choose a state.';
  }
  if (!/^[1-9]\d{5}$/.test(draft.postalCode.trim())) {
    errors.postalCode = 'Enter a valid 6-digit PIN code.';
  }

  return errors;
}

export function AddressFields({
  draft,
  errors,
  touched,
  onChange,
  onBlur,
}: {
  draft: AddressDraft;
  errors: AddressErrors;
  touched: Record<string, boolean>;
  onChange: (patch: Partial<AddressDraft>) => void;
  onBlur: (field: keyof AddressDraft) => void;
}) {
  const show = (field: keyof AddressDraft) =>
    touched[field] && errors[field] ? errors[field] : undefined;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label="Full name" htmlFor="addr-name" error={show('fullName')}>
        <Input
          id="addr-name"
          autoComplete="name"
          value={draft.fullName}
          onBlur={() => onBlur('fullName')}
          onChange={(e) => onChange({ fullName: e.target.value })}
          aria-invalid={Boolean(show('fullName'))}
        />
      </Field>

      <Field
        label="Mobile number"
        htmlFor="addr-phone"
        hint="Used only for delivery updates"
        error={show('phone')}
      >
        <Input
          id="addr-phone"
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          maxLength={10}
          value={draft.phone}
          onBlur={() => onBlur('phone')}
          onChange={(e) => onChange({ phone: e.target.value.replace(/\D/g, '').slice(0, 10) })}
          aria-invalid={Boolean(show('phone'))}
        />
      </Field>

      <div className="sm:col-span-2">
        <Field
          label="Address line 1"
          htmlFor="addr-line1"
          hint="House / flat no., building, street"
          error={show('line1')}
        >
          <Input
            id="addr-line1"
            autoComplete="address-line1"
            value={draft.line1}
            onBlur={() => onBlur('line1')}
            onChange={(e) => onChange({ line1: e.target.value })}
            aria-invalid={Boolean(show('line1'))}
          />
        </Field>
      </div>

      <div className="sm:col-span-2">
        <Field label="Address line 2" htmlFor="addr-line2" hint="Area, landmark (optional)">
          <Input
            id="addr-line2"
            autoComplete="address-line2"
            value={draft.line2}
            onChange={(e) => onChange({ line2: e.target.value })}
          />
        </Field>
      </div>

      <Field label="City" htmlFor="addr-city" error={show('city')}>
        <Input
          id="addr-city"
          autoComplete="address-level2"
          value={draft.city}
          onBlur={() => onBlur('city')}
          onChange={(e) => onChange({ city: e.target.value })}
          aria-invalid={Boolean(show('city'))}
        />
      </Field>

      <Field label="State" htmlFor="addr-state" error={show('state')}>
        <Select
          id="addr-state"
          autoComplete="address-level1"
          value={draft.state}
          onBlur={() => onBlur('state')}
          onChange={(e) => onChange({ state: e.target.value })}
          aria-invalid={Boolean(show('state'))}
        >
          <option value="">Select a state</option>
          {INDIAN_STATES.map((state) => (
            <option key={state} value={state}>
              {state}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="PIN code" htmlFor="addr-pin" error={show('postalCode')}>
        <Input
          id="addr-pin"
          inputMode="numeric"
          autoComplete="postal-code"
          maxLength={6}
          value={draft.postalCode}
          onBlur={() => onBlur('postalCode')}
          onChange={(e) => onChange({ postalCode: e.target.value.replace(/\D/g, '').slice(0, 6) })}
          aria-invalid={Boolean(show('postalCode'))}
        />
      </Field>

      <Field label="Save as" htmlFor="addr-label" hint="Home, Office, Parents’ place">
        <Select
          id="addr-label"
          value={draft.label}
          onChange={(e) => onChange({ label: e.target.value })}
        >
          <option>Home</option>
          <option>Work</option>
          <option>Other</option>
        </Select>
      </Field>
    </div>
  );
}

export { Textarea };
