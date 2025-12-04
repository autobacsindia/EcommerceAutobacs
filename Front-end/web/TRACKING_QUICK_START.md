# Tracking Interface - Quick Start Guide

## 🚀 Getting Started

### Prerequisites
1. Backend server running on `http://localhost:5000`
2. MongoDB with tracking data
3. (Optional) Google Maps API key for map features

### Setup

1. **Configure Google Maps API (Optional)**
   ```bash
   # Edit .env.local
   NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your_actual_key_here
   ```
   > Without API key, map will show a text-based fallback

2. **Start the Frontend**
   ```bash
   cd Autobacs/Front-end/web
   npm run dev
   ```

3. **Access Tracking Page**
   - Navigate to: `http://localhost:3000/track`
   - Or use direct URL: `http://localhost:3000/track?number=176467645763`

## 📦 For Customers - Tracking an Order

### Method 1: Via Tracking Page
1. Go to `/track`
2. Enter your tracking number (e.g., `176467645763`)
3. Click "Track" or press Enter
4. View your order status, timeline, and map

### Method 2: Via Direct URL
Share this URL format with customers:
```
http://localhost:3000/track?number=TRACKING_NUMBER_HERE
```

### What Customers See
- **Order Summary**: Tracking number, carrier, status, delivery date, destination
- **Timeline**: Visual journey of the package with all events
- **Map**: Interactive map showing current location and destination
- **Carrier Link**: Direct link to carrier's website for more details

## 🔧 For Admins - Adding Tracking

### From Order Management Page

1. **Navigate to Order**
   - Go to order details page for the order

2. **Add Tracking Button**
   - Click "Add Tracking" button
   - Modal will open

3. **Select Carrier**
   - Search or browse carriers
   - Filter by: All, Fastest, International
   - Click on carrier card to select

4. **Optional: Enter Tracking Number**
   - Leave empty for auto-generation
   - Or enter existing tracking number

5. **Add Notes** (Optional)
   - Add any internal notes

6. **Submit**
   - Click "Add Tracking"
   - Order status automatically updates to "shipped"

### Using the Components Programmatically

```typescript
import { AddTrackingModal } from '@/components/tracking';

function OrderDetailPage() {
  const [showModal, setShowModal] = useState(false);
  
  const handleSuccess = () => {
    // Refresh order data
    console.log('Tracking added successfully!');
  };
  
  return (
    <>
      <button onClick={() => setShowModal(true)}>
        Add Tracking
      </button>
      
      <AddTrackingModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        orderId={orderId}
        onSuccess={handleSuccess}
      />
    </>
  );
}
```

## 🧪 Testing

### Test Scenario 1: Valid Tracking Number
```bash
# Backend should have this tracking number in database
# Test with: 176467645763 (or use simulation endpoint)
```

1. Go to `/track`
2. Enter: `176467645763`
3. Expected: See order details, timeline, and map

### Test Scenario 2: Invalid Tracking Number
1. Go to `/track`
2. Enter: `INVALID123`
3. Expected: "Tracking number not found" error

### Test Scenario 3: Rate Limiting
1. Track the same number 11 times quickly
2. Expected: "Too many attempts. Please try again in X minutes."

### Test Scenario 4: No Map API Key
1. Don't set `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`
2. Track an order
3. Expected: Map section shows text-based location list

### Test with Backend Simulation

```bash
# In backend directory
node test-order-tracking.js

# This creates test tracking data
# Then use the generated tracking number in frontend
```

## 📱 Mobile Testing

1. **Open DevTools** (F12)
2. **Toggle Device Toolbar** (Ctrl+Shift+M)
3. **Select Device**:
   - iPhone SE (375px) - Small mobile
   - iPad (768px) - Tablet
   - Desktop (1920px) - Large desktop

### Expected Behavior
- **Mobile**: Stacked layout, timeline above map
- **Tablet**: Optimized spacing, side-by-side on larger tablets
- **Desktop**: Full side-by-side layout

## 🎨 Customization

### Changing Colors
Edit `tailwind.config.js` or use Tailwind classes:
- Blue primary: `bg-blue-600` → Change to your brand color
- Success green: `bg-green-500`
- Warning orange: `bg-orange-500`
- Error red: `bg-red-500`

### Adding New Event Types
1. Add to `EventStatus` type in `types/tracking.ts`
2. Add icon in `trackingHelpers.tsx` → `getEventIcon()`
3. Add color in `trackingHelpers.tsx` → `getEventColor()`

### Customizing Timeline
Edit `TimelineEvent.tsx`:
- Change icon sizes
- Modify spacing
- Add more event details
- Change date/time formatting

## 🔍 Troubleshooting

### Issue: "Failed to load map service"
**Solution**: 
- Check `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` in `.env.local`
- Verify API key is valid
- Enable "Maps JavaScript API" in Google Cloud Console
- Check browser console for detailed errors

### Issue: "Tracking number not found"
**Solution**:
- Verify tracking number exists in database
- Check backend is running: `http://localhost:5000`
- Test backend endpoint directly: `GET /orders/track/TRACKING_NUMBER`

### Issue: Timeline shows no events
**Solution**:
- Check if order has tracking events in database
- Use backend simulation to add test events
- Verify API response includes `events` array

### Issue: Map shows no markers
**Solution**:
- Ensure event locations are geocodable
- Check browser console for geocoding errors
- Locations should be specific (e.g., "Mumbai, Maharashtra" not just "Mumbai")

## 📊 API Testing

### Test Public Tracking Endpoint
```bash
# Using curl
curl http://localhost:5000/orders/track/176467645763

# Expected response
{
  "success": true,
  "trackingNumber": "176467645763",
  "carrier": {
    "name": "Delhivery",
    "code": "DELHIVERY",
    "trackingUrl": "https://www.delhivery.com/track/package/176467645763"
  },
  "currentStatus": "shipped",
  "estimatedDelivery": "2024-12-04T10:00:00Z",
  "destination": {
    "city": "Mumbai",
    "state": "Maharashtra",
    "postalCode": "400001"
  },
  "events": [...]
}
```

### Test Carriers Endpoint
```bash
curl http://localhost:5000/orders/tracking/carriers

# Expected response
{
  "success": true,
  "carriers": [
    {
      "name": "Delhivery",
      "code": "DELHIVERY",
      "estimatedDeliveryDays": 2
    },
    ...
  ]
}
```

## 🎯 Best Practices

### For Administrators
1. Always select the correct carrier
2. Let tracking numbers auto-generate for consistency
3. Add notes for internal reference
4. Test tracking link before sharing with customer

### For Developers
1. Keep API keys secure (never commit to git)
2. Use environment variables for all configs
3. Handle all error states gracefully
4. Test on multiple devices and browsers

### For Customer Support
1. Share tracking URL in email/SMS
2. Inform customers about 10 lookups/hour limit
3. Direct customers to carrier website for detailed info
4. Use notes field to track customer inquiries

## 📝 Next Steps

1. **Configure Production API Keys**
   - Get production Google Maps API key
   - Update environment variables
   - Set up domain restrictions

2. **Customize Branding**
   - Update logo in header
   - Change color scheme
   - Add custom carrier logos

3. **Enable Notifications**
   - Set up email notifications for tracking updates
   - Configure SMS alerts (optional)

4. **Monitor Usage**
   - Track API usage (Google Maps quota)
   - Monitor rate limit violations
   - Analyze popular carriers

## 🆘 Support

- **Implementation Doc**: `TRACKING_INTERFACE_IMPLEMENTATION.md`
- **Design Doc**: `.qoder/quests/tracking-interface-implementation.md`
- **Backend API**: `Autobacs/Back-end/server/ORDER_TRACKING_DOCUMENTATION.md`

---

**Happy Tracking! 📦🚚**
