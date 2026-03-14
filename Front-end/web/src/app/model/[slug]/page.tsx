import { Metadata } from 'next';
import ClientPage from './ClientPage';
import { VEHICLE_IMAGE_MAP } from '@/services/vehicleService';
import { getServerApiBase } from '@/lib/server-api';

async function getVehicleForMetadata(slug: string) {
  try {
    const res = await fetch(`${getServerApiBase()}/vehicles/slug/${slug}`, { next: { revalidate: 3600 } });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.success && data.vehicle) {
        return data.vehicle;
    }
    return null;
  } catch (error) {
    console.error('Metadata fetch error:', error);
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const vehicle = await getVehicleForMetadata(slug);

  const vehicleName = vehicle ? (vehicle.name || `${vehicle.make} ${vehicle.model}`) : slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  
  const title = `${vehicleName} Accessories | Autobacs India`;
  const description = `Shop premium accessories, body kits, and parts for ${vehicleName} at Autobacs India. Best prices and wide selection.`;

  const images = [];
  
  if (vehicle && vehicle.image) {
      if (typeof vehicle.image === 'string') {
          images.push(vehicle.image);
      } else if (vehicle.image.url) {
          images.push(vehicle.image.url);
      }
  }
  
  if (images.length === 0 && VEHICLE_IMAGE_MAP[slug]) {
      images.push(VEHICLE_IMAGE_MAP[slug]);
  } else if (images.length === 0) {
      images.push(`/images/vehicles/${slug}.jpg`);
  }

  return {
    title,
    description,
    openGraph: {
       title,
       description,
       images,
       type: 'website',
    },
    twitter: {
        card: 'summary_large_image',
        title,
        description,
        images,
    }
  }
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <ClientPage slug={slug} />;
}
