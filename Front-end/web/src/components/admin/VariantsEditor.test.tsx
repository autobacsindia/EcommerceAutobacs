/**
 * Tests — VariantsEditor removal confirmation + payload serialization.
 *
 * Removing a model is DESTRUCTIVE once models own photos: the server reclaims
 * the image uploaded for that model and deletes it from storage, unrecoverably.
 * The confirmation wording is the only thing standing between an admin and that,
 * so it is asserted here rather than left as incidental UI text.
 *
 * The second concern is that `imageKey` is a POINTER and its ABSENCE is
 * meaningful — absent tells the server "use the product's main image". A
 * serializer that helpfully sent `imageKey: null` would disable the fallback on
 * every model in the catalogue.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import VariantsEditor, {
  removeVariantMessage,
  serializeVariants,
  type EditorVariant,
} from './VariantsEditor';

const variant = (over: Partial<EditorVariant> = {}): EditorVariant => ({
  label: 'smoked lights',
  price: '12500',
  stock: 'in',
  ...over,
});

describe('removeVariantMessage', () => {
  test('warns that the photo is permanently deleted when the model has one', () => {
    const msg = removeVariantMessage(variant({ imageKey: 'smoked' }));
    expect(msg).toContain('permanently delete');
    expect(msg).toContain("model's photo");
    expect(msg).toContain('cannot be undone');
  });

  test('points at the escape hatch instead of leaving it as a dead end', () => {
    expect(removeVariantMessage(variant({ imageKey: 'smoked' }))).toContain('Keep in gallery');
  });

  test('names the model, so a mis-click on the wrong row is visible', () => {
    expect(removeVariantMessage(variant({ label: '32 Inch Dual Row', imageKey: 'x' })))
      .toContain('32 Inch Dual Row');
  });

  test('a model with no photo gets the quieter prompt — nothing is destroyed', () => {
    const msg = removeVariantMessage(variant());
    expect(msg).not.toContain('permanently delete');
    expect(msg).toContain('smoked lights');
  });

  test('falls back to a generic name for an unlabelled row', () => {
    expect(removeVariantMessage(variant({ label: '', imageKey: 'x' }))).toContain('this model');
  });
});

describe('VariantsEditor — removal', () => {
  const setup = (variants: EditorVariant[]) => {
    const onChange = jest.fn();
    render(
      <VariantsEditor
        attributeName="models"
        onAttributeNameChange={() => {}}
        variants={variants}
        onChange={onChange}
      />
    );
    return onChange;
  };

  afterEach(() => jest.restoreAllMocks());

  test('a confirmed removal drops the row', () => {
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    const onChange = setup([variant({ imageKey: 'smoked' }), variant({ label: 'clear lights' })]);

    fireEvent.click(screen.getByLabelText('Remove model smoked lights'));

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('permanently delete'));
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ label: 'clear lights' })]);
  });

  test('a cancelled removal changes NOTHING — the row and its photo survive', () => {
    jest.spyOn(window, 'confirm').mockReturnValue(false);
    const onChange = setup([variant({ imageKey: 'smoked' })]);

    fireEvent.click(screen.getByLabelText('Remove model smoked lights'));

    expect(window.confirm).toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  test('a blank row the admin just added is removed without friction', () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
    const onChange = setup([variant({ label: '', price: '', imageKey: undefined })]);

    fireEvent.click(screen.getByLabelText('Remove model'));

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith([]);
  });
});

describe('serializeVariants — the pointer', () => {
  test('carries imageKey when the model has a photo', () => {
    const [out] = serializeVariants('models', [variant({ imageKey: 'smoked' })]);
    expect(out.imageKey).toBe('smoked');
  });

  test('OMITS imageKey when absent — never sends null', () => {
    const [out] = serializeVariants('models', [variant()]);
    expect('imageKey' in out).toBe(false);
  });

  test('omits it for an empty string too', () => {
    const [out] = serializeVariants('models', [variant({ imageKey: '' })]);
    expect('imageKey' in out).toBe(false);
  });

  test('leaves the rest of the payload contract intact', () => {
    const [out] = serializeVariants('models', [variant({ _id: 'v1', imageKey: 'smoked', sku: 'SKU-1' })]);
    expect(out).toMatchObject({
      _id: 'v1',
      label: 'smoked lights',
      price: 12500,
      sku: 'SKU-1',
      imageKey: 'smoked',
      attributes: [{ name: 'models', option: 'smoked lights' }],
    });
  });
});
