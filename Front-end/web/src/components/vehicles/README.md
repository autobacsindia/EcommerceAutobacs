# Vehicle Components

This directory contains components related to vehicle-based navigation and filtering.

## Components

### VehicleSelector
A dropdown component that allows users to select a vehicle make and model. It fetches vehicle data from the backend API and provides real-time filtering capabilities.
**Props:**
- `onVehicleSelect`: Function called when a vehicle is selected

**Usage:**
```tsx
import VehicleSelector from '@/components/vehicles/VehicleSelector';

<VehicleSelector onVehicleSelect={(make, model) => console.log(make, model)} />
```

### VehicleFilterSidebar
A sidebar component for filtering products by vehicle make and model. It integrates with the existing ProductFilters component and shows active filters with clear functionality.
**Usage:**
```tsx
import VehicleFilterSidebar from '@/components/vehicles/VehicleFilterSidebar';

<VehicleFilterSidebar />
```

## Integration

These components work with the following API endpoints:
- `/vehicles/makes` - Fetch all vehicle makes
- `/vehicles/models/:make` - Fetch models for a specific make

The products API has been extended to support vehicle filtering parameters:
- `vehicleMake` - Filter by vehicle make
- `vehicleModel` - Filter by vehicle model