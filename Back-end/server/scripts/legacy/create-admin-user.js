import dotenv from 'dotenv';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import User from '../../models/User.js';

// Load environment variables
dotenv.config();

/**
 * Create-or-reset the admin account from environment variables.
 *
 * This script is idempotent and safe to re-run:
 *   - If the admin does not exist, it is created.
 *   - If it already exists, its password is reset and `role: admin` re-asserted,
 *     and ALL existing sessions/tokens for that account are invalidated
 *     (sessionVersion bump + tokenInvalidBefore) so a leaked or stale session
 *     cannot survive a password rotation.
 *
 * Credentials are NEVER hardcoded. Provide them via env vars (locally in `.env`,
 * in production via the Railway dashboard):
 *
 *   ADMIN_EMAIL     (optional, default: info@autobacsindia.com)
 *   ADMIN_PASSWORD  (REQUIRED — no default; script aborts if missing/weak)
 *   ADMIN_NAME      (optional, default: "Admin")
 *
 * Run:  npm run seed:admin
 */

const DEFAULT_ADMIN_EMAIL = 'info@autobacsindia.com';
const MIN_PASSWORD_LENGTH = 12;
// Matches the rounds used everywhere else in the app (auth.js).
const BCRYPT_ROUNDS = 10;

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

async function run() {
  const email = (process.env.ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL).toLowerCase().trim();
  const password = process.env.ADMIN_PASSWORD;
  const name = (process.env.ADMIN_NAME || 'Admin').trim();

  // ── Validate inputs (fail hard, never fall back to a literal) ──────────────
  if (!process.env.MONGO_URI) {
    fail('MONGO_URI is not set. Cannot connect to the database.');
  }
  if (!password) {
    fail(
      'ADMIN_PASSWORD is not set. Set it in .env locally or in the Railway ' +
      'dashboard. This script will not create an admin with a default password.'
    );
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    fail(`ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB');

  try {
    const salt = await bcrypt.genSalt(BCRYPT_ROUNDS);
    const passwordHash = await bcrypt.hash(password, salt);

    const existing = await User.findOne({ email });

    if (existing) {
      existing.passwordHash = passwordHash;
      existing.role = 'admin';
      existing.isVerified = true;
      existing.mustResetPassword = false;
      // Invalidate every existing session/token for this account so a rotated
      // password takes effect immediately and any stale session is killed.
      existing.sessionVersion = (existing.sessionVersion || 0) + 1;
      existing.tokenInvalidBefore = new Date();
      // Force a fresh login to re-bind admin IP/UA context.
      existing.lastAdminIPHash = undefined;
      existing.lastAdminUAHash = undefined;

      await existing.save();

      console.log('✅ Admin password reset and role re-asserted.');
      console.log(`   Email: ${email}`);
      console.log('   All existing sessions for this account were invalidated.');
      console.log('   Log in again to mint a fresh admin token.');
    } else {
      await User.create({
        name,
        email,
        passwordHash,
        role: 'admin',
        isVerified: true,
      });

      console.log('✅ Admin user created.');
      console.log(`   Email: ${email}`);
    }
  } finally {
    await mongoose.connection.close();
  }
}

run().catch((error) => {
  console.error('❌ Error managing admin user:', error.message);
  mongoose.connection.close().finally(() => process.exit(1));
});
