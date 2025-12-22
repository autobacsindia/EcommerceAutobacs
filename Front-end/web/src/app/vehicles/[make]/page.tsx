'use client';

import WordPressVehicleProductsPage from './wordpress-page';

export default function VehicleProductsPage({ params }: { params: Promise<{ make: string }> }) {
  return <WordPressVehicleProductsPage params={params} />;
}