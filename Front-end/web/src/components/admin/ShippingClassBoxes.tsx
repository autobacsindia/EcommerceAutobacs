'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminKeys } from '@/hooks/queries/keys';
import {
  BOXED_SHIPPING_CLASSES,
  SHIPPING_CLASS_LABELS,
  classForChargeableKg,
  fetchClassBoxes,
  saveClassBoxes,
  type BoxedShippingClass,
  type ClassBoxes,
} from '@/lib/shippingClass';
import {
  SHIPPING_SIZE_KEYS,
  SHIPPING_SIZE_LABELS,
  chargeableWeightKg,
  firstShippingSizeError,
  shippingSizeToForm,
  type ShippingSizeForm,
} from '@/lib/shippingSize';

type Forms = Record<BoxedShippingClass, ShippingSizeForm>;
const toForms = (boxes: ClassBoxes): Forms =>
  Object.fromEntries(BOXED_SHIPPING_CLASSES.map((c) => [c, shippingSizeToForm(boxes[c])])) as Forms;

/**
 * The standard box per class — what a fee estimate will assume for a product that
 * has a class but no measured box. XL has none (quoted by hand). Admin edits.
 */
export default function ShippingClassBoxes({ canEdit }: { canEdit: boolean }) {
  const key = adminKeys.list('shipping-class-boxes', {});
  const queryClient = useQueryClient();
  const { data, isPending, isError } = useQuery({ queryKey: key, queryFn: fetchClassBoxes });
  const [draft, setDraft] = useState<Forms | null>(null);
  const forms = draft ?? (data ? toForms(data.boxes) : null);

  const save = useMutation({
    mutationFn: (f: Forms) => saveClassBoxes(f),
    onSuccess: (res) => {
      queryClient.setQueryData(key, res);
      setDraft(null);
    },
  });

  const error = forms
    ? BOXED_SHIPPING_CLASSES.map((c) => {
      const e = firstShippingSizeError(forms[c]);
      if (e) return `${SHIPPING_CLASS_LABELS[c]}: ${e}`;
      return SHIPPING_SIZE_KEYS.some((k) => !forms[c][k].trim()) ? `${SHIPPING_CLASS_LABELS[c]}: fill in all four` : null;
    }).find(Boolean) ?? null
    : null;

  return (
    <details className="mt-4 border-t border-gray-100 pt-3">
      <summary className="cursor-pointer text-sm font-medium text-gray-700">Standard box for each class</summary>
      {isPending && <p className="mt-2 text-sm text-gray-500">Loading...</p>}
      {isError && <p className="mt-2 text-sm text-red-700">Couldn&apos;t load the boxes.</p>}
      {forms && (
        <div className="mt-3 space-y-3">
          {BOXED_SHIPPING_CLASSES.map((c) => {
            const charged = chargeableWeightKg(forms[c]);
            const lands = classForChargeableKg(charged);
            return (
              <div key={c}>
                <p className="text-sm font-medium">{SHIPPING_CLASS_LABELS[c]}</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {SHIPPING_SIZE_KEYS.map((k) => (
                    <label key={k} className="text-xs text-gray-600">
                      {SHIPPING_SIZE_LABELS[k]}
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="any"
                        disabled={!canEdit}
                        value={forms[c][k]}
                        onChange={(e) => setDraft({ ...forms, [c]: { ...forms[c], [k]: e.target.value } })}
                        className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-50"
                      />
                    </label>
                  ))}
                </div>
                {lands && lands !== c && (
                  <p className="mt-1 text-xs text-amber-700">
                    Couriers would charge this box as {charged} kg, which is {SHIPPING_CLASS_LABELS[lands]}, not {SHIPPING_CLASS_LABELS[c]}.
                  </p>
                )}
              </div>
            );
          })}
          <p className="text-xs text-gray-500">XL has no standard box: it is quoted after the order.</p>
          {canEdit ? (
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={!draft || !!error || save.isPending}
                onClick={() => draft && save.mutate(draft)}
                className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {save.isPending ? 'Saving…' : 'Save boxes'}
              </button>
              {error && <span className="text-xs text-red-700">{error}</span>}
              {save.isError && <span role="status" className="text-xs text-red-700">{save.error instanceof Error ? save.error.message : 'Could not save.'}</span>}
              {save.isSuccess && !draft && <span role="status" className="text-xs text-green-700">Saved.</span>}
            </div>
          ) : (
            <p className="text-xs text-gray-500">Only an admin can change these.</p>
          )}
        </div>
      )}
    </details>
  );
}
