# 🚀 CRITICAL Pre-Launch Checklist

**DO NOT LAUNCH UNTIL ALL ITEMS ARE CHECKED**

Last updated: 2026-04-18

---

## 🔥 IMMEDIATE ACTIONS (Day 1 - Before Anything Else)

### 1. Secrets Rotation
- [ ] **Rotate MongoDB credentials** in Atlas dashboard
  - Go to: https://cloud.mongodb.com/ > Database Access
  - Change password for `Autobacs_info_db`
  - Update `MONGO_URI` in Railway environment variables
  
- [ ] **Rotate MongoDB Atlas API keys**
  - Go to: Atlas > Organization Settings > Access Manager > API Keys
  - Delete old keys, create new ones
  - Update `MONGODB_ATLAS_PUBLIC_API_KEY` and `MONGODB_ATLAS_PRIVATE_API_KEY` in Railway

- [ ] **Rotate SendGrid API key**
  - Go to: https://app.sendgrid.com/settings/api_keys
  - Delete old key, create new one
  - Update `SENDGRID_API_KEY` in Railway

- [ ] **Rotate Google Maps API keys**
  - Go to: Google Cloud Console > APIs & Services > Credentials
  - Create new keys with proper restrictions
  - Update `GOOGLE_MAPS_CLIENT_KEY` and `GOOGLE_MAPS_SERVER_KEY` in Railway

- [ ] **Rotate Google OAuth client secret**
  - Go to: Google Cloud Console > APIs & Services > Credentials
  - Reset OAuth client secret
  - Update `GOOGLE_CLIENT_SECRET` in Railway

- [ ] **Rotate Facebook app secret**
  - Go to: https://developers.facebook.com/apps/
  - Reset App Secret
  - Update `FACEBOOK_CLIENT_SECRET` in Railway

- [ ] **Rotate Cloudinary API secret**
  - Go to: https://cloudinary.com/console > Settings > Security
  - Regenerate API Secret
  - Update `CLOUDINARY_API_SECRET` in Railway

- [ ] **Generate new JWT secret**
  - Run: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`
  - Update `JWT_SECRET` in Railway
  - **WARNING**: All existing user sessions will be invalidated

### 2. Payment Gateway Configuration
- [ ] **Switch Razorpay to LIVE mode**
  - Go to: https://dashboard.razorpay.com/app/keys
  - Switch to LIVE mode
  - Copy LIVE Key ID (starts with `rzp_live_*`)
  - Copy LIVE Key Secret
  - Update `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in Railway
  - **VERIFY**: Keys must start with `rzp_live_*`, NOT `rzp_test_*`

- [ ] **Test payment flow with LIVE keys**
  - Make a test purchase with real payment method
  - Verify webhook endpoint receives events
  - Check order creation in database
  - Verify email notifications are sent

### 3. Environment Variables
- [ ] **Set NODE_ENV=production** in Railway
- [ ] **Set FRONTEND_URL** to actual frontend URL: `https://ecommerceautobacs-production-1716.up.railway.app`
- [ ] **Set NEXT_PUBLIC_API_URL** to actual backend URL: `https://ecommerceautobacs-production.up.railway.app`
- [ ] **Remove all localhost references** from production environment variables
- [ ] **Run validation script**: `cd Autobacs/Back-end/server && node scripts/validate-production-env.js`
  - Must pass with 0 errors

---

## ⚠️ SECURITY CHECKS (Day 2)

### 4. Database Security
- [ ] **Remove TLS fallback logic** (✅ COMPLETED - Code updated)
  - Verified in `config/db.js` - no TLS disable fallback
  - Production will fail to start if TLS cannot be established

- [ ] **Run database indexes migration**
  - Execute: `cd Autobacs/Back-end/server && node scripts/ensure-production-indexes.js`
  - Verify all indexes created successfully
  - Check MongoDB Atlas for index creation

- [ ] **Verify MongoDB network access**
  - Go to: Atlas > Network Access
  - Ensure only Railway IP ranges are whitelisted (or 0.0.0.0/0 if using VPC)
  - Remove any unnecessary IP addresses

### 5. CORS Configuration
- [ ] **Verify CORS settings** (✅ COMPLETED - Code updated)
  - Removed dynamic Railway review app allowance
  - Only explicitly whitelisted origins allowed
  - FRONTEND_URL must be set in Railway

### 6. Security Headers
- [ ] **Verify security headers** are set:
  - Content-Security-Policy
  - Strict-Transport-Security (HSTS)
  - X-Content-Type-Options
  - X-Frame-Options
  - Referrer-Policy

- [ ] **Test CSP violation reporting**
  - Access: `https://ecommerceautobacs-production.up.railway.app/api/v1/security/headers-test`
  - Verify CSP report-uri is set

---

## 🚀 PERFORMANCE & RELIABILITY (Day 3-4)

### 7. Caching
- [ ] **Verify Cache-Control headers** (✅ COMPLETED - Code updated)
  - Product listings: 5 minutes
  - Product details: 10 minutes
  - Categories/Brands: 1 hour
  - Test with browser dev tools or curl

- [ ] **Configure Redis** (if using)
  - Ensure `REDIS_URL` is set in Railway
  - Test Redis connection
  - Verify rate limiting uses Redis (not in-memory)

### 8. Monitoring & Logging
- [ ] **Verify Sentry integration**
  - Check Sentry dashboard for error events
  - Test error tracking by triggering a test error
  - Set up email/Slack alerts for critical errors

- [ ] **Verify LogRocket integration** (frontend)
  - Check LogRocket dashboard for session recordings
  - Verify user actions are being tracked

- [ ] **Set up health check monitoring**
  - Monitor: `https://ecommerceautobacs-production.up.railway.app/health`
  - Set up alerts for downtime
  - Configure Railway notifications

### 9. Database Connection
- [ ] **Test MongoDB connection pool**
  - Monitor connection count in Atlas
  - Verify `maxPoolSize: 20` is appropriate
  - Check for connection leaks under load

---

## 🧪 TESTING (Day 5-7)

### 10. Critical Flow Testing
- [ ] **Test user registration flow**
  - Register new user
  - Verify email sent
  - Verify email verification works

- [ ] **Test login flow**
  - Login with email/password
  - Login with Google OAuth
  - Login with Facebook OAuth

- [ ] **Test product browsing**
  - Browse products by category
  - Search for products
  - Filter by brand, price
  - View product details

- [ ] **Test cart operations**
  - Add to cart
  - Update cart quantity
  - Remove from cart
  - Guest cart → User cart merge on login

- [ ] **Test checkout flow (CRITICAL)**
  - Add products to cart
  - Proceed to checkout
  - Enter shipping address
  - Select delivery option
  - **Make real payment with Razorpay LIVE**
  - Verify order created
  - Verify confirmation email sent

- [ ] **Test order management**
  - View order history
  - Track order status
  - Test order cancellation (if allowed)

- [ ] **Test admin dashboard**
  - Login as admin
  - View dashboard metrics
  - Manage products
  - Manage orders
  - View analytics

### 11. Load Testing
- [ ] **Run load test with Artillery**
  - Execute: `cd Autobacs/Back-end/server && npm run load-test:quick`
  - Verify P95 latency < 2 seconds
  - Verify no 5xx errors under load
  - Check MongoDB connection pool utilization

### 12. Edge Cases
- [ ] **Test error handling**
  - Invalid payment
  - Network timeout during checkout
  - Database connection failure
  - Invalid input data

- [ ] **Test mobile responsiveness**
  - Test on iPhone (Safari)
  - Test on Android (Chrome)
  - Test on tablet devices

---

## 🌍 SEO & MARKETING (Day 8)

### 13. SEO Readiness
- [ ] **Verify robots.txt**
  - Access: `https://ecommerceautobacs-production-1716.up.railway.app/robots.txt`
  - Ensure admin pages are disallowed
  - Ensure product pages are allowed

- [ ] **Submit sitemap to Google**
  - Access: `https://ecommerceautobacs-production-1716.up.railway.app/sitemap.xml`
  - Submit to Google Search Console
  - Submit to Bing Webmaster Tools

- [ ] **Verify meta tags**
  - Product pages have unique titles and descriptions
  - Open Graph tags present for social sharing
  - Twitter Card tags present

- [ ] **Test structured data**
  - Use Google Rich Results Test: https://search.google.com/test/rich-results
  - Test product pages for Product schema
  - Fix any errors

### 14. Analytics
- [ ] **Set up Google Analytics**
  - Add GA4 tracking code to frontend
  - Verify events are tracked
  - Set up conversion tracking

- [ ] **Set up Google Search Console**
  - Verify site ownership
  - Submit sitemap
  - Monitor for crawl errors

---

## 📋 FINAL VERIFICATION (Day 9-10)

### 15. Pre-Launch Verification
- [ ] **All secrets rotated** and stored in Railway
- [ ] **Razorpay LIVE keys** configured and tested
- [ ] **NODE_ENV=production** set
- [ ] **Environment validation** passed (0 errors)
- [ ] **Database indexes** created
- [ ] **Caching** enabled and verified
- [ ] **Monitoring** active (Sentry, LogRocket)
- [ ] **Health checks** configured
- [ ] **All critical flows** tested successfully
- [ ] **Load test** passed (P95 < 2s)
- [ ] **SEO** configured (robots.txt, sitemap, meta tags)
- [ ] **Analytics** tracking (Google Analytics, Search Console)

### 16. Rollback Plan
- [ ] **Document rollback procedure**
  - How to rollback Railway deployment
  - How to rollback database migrations
  - Who to contact in case of issues

- [ ] **Prepare rollback triggers**
  - Define what constitutes a rollback (e.g., > 5% error rate)
  - Set up alerts for rollback triggers

### 17. Support Readiness
- [ ] **Prepare customer support documentation**
  - Common issues and solutions
  - Order tracking instructions
  - Return/refund process

- [ ] **Set up support channels**
  - Support email monitored
  - Phone support (if applicable)
  - Live chat (if applicable)

---

## 🚦 GO/NO-GO DECISION

**Only launch if ALL items above are checked.**

### Launch Day Checklist:
- [ ] Final database backup created
- [ ] Team notified of launch
- [ ] Monitoring dashboards open
- [ ] Support team ready
- [ ] Rollback plan reviewed
- [ ] **DEPLOY TO PRODUCTION**
- [ ] Verify health check: `https://ecommerceautobacs-production.up.railway.app/health`
- [ ] Verify frontend loads: `https://ecommerceautobacs-production-1716.up.railway.app`
- [ ] Make test purchase with real payment
- [ ] Monitor error rates for first hour
- [ ] Monitor database performance
- [ ] Monitor payment webhook delivery

---

## 📞 Emergency Contacts

- **MongoDB Atlas Support**: https://support.mongodb.com/
- **Railway Support**: https://railway.com/support
- **Razorpay Support**: https://razorpay.com/support/
- **SendGrid Support**: https://support.sendgrid.com/

---

## 📝 Post-Launch Monitoring (First 7 Days)

### Day 1-2: Intensive Monitoring
- Monitor error rates every hour
- Check payment success rate
- Monitor database connection pool
- Review Sentry errors
- Check user feedback

### Day 3-7: Regular Monitoring
- Monitor error rates twice daily
- Review order completion rate
- Check email delivery rates
- Monitor site performance
- Review analytics data

### Week 2+: Ongoing Maintenance
- Weekly security review
- Monthly performance optimization
- Quarterly secret rotation
- Continuous monitoring and improvement

---

**Remember: It's better to delay launch than to launch with critical security or payment issues.**
