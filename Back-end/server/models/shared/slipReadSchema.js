import mongoose from 'mongoose';

/**
 * Where each typed field on a payment record came from, when its slip was read
 * automatically (services/slipReader). Shown to accounts beside each field:
 *
 *   'slip'   — saved exactly as read from the slip
 *   'edited' — read from the slip, then changed by the person who saved it
 *   'typed'  — the slip did not show it; a person typed it
 *
 * Decided by the SERVER on save, from a signed copy of what was read — the
 * browser cannot claim "read from slip". null when no slip was read (every
 * record before this shipped, and every save while the reader is off).
 */
const SOURCES = ['slip', 'edited', 'typed'];

export const SlipReadSchema = new mongoose.Schema(
  {
    readAt: { type: Date, required: true },
    model: { type: String, default: '', maxlength: 60 },
    fields: {
      reference: { type: String, enum: SOURCES, default: undefined },
      date: { type: String, enum: SOURCES, default: undefined },
      amount: { type: String, enum: SOURCES, default: undefined },
    },
  },
  { _id: false },
);

export default SlipReadSchema;
