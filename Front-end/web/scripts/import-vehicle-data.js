const axios = require('axios');

// Function to import vehicle data to the backend
async function importVehicleData() {
  console.log('Starting vehicle data import...');

  // Sample vehicle data with image URLs
  const vehicles = [
    {
      make: 'Toyota',
      model: 'Hilux',
      year: 2023,
      variant: 'V6',
      slug: 'toyota-hilux',
      image: {
        url: 'https://autobacsindia.com/wp-content/uploads/2023/01/toyota-hilux.jpg',
        alt: 'Toyota Hilux'
      }
    },
    {
      make: 'Mahindra',
      model: 'Thar',
      year: 2023,
      variant: 'LX',
      slug: 'mahindra-thar',
      image: {
        url: 'https://autobacsindia.com/wp-content/uploads/2023/01/mahindra-thar.jpg',
        alt: 'Mahindra Thar'
      }
    },
    {
      make: 'Isuzu',
      model: 'D-Max V-Cross',
      year: 2023,
      variant: 'Z Prestige',
      slug: 'isuzu-dmax-v-cross',
      image: {
        url: 'https://autobacsindia.com/wp-content/uploads/2023/01/isuzu-dmax-v-cross.jpg',
        alt: 'Isuzu D-Max V-Cross'
      }
    },
    {
      make: 'Maruti',
      model: 'Jimny',
      year: 2023,
      variant: 'LXI',
      slug: 'maruti-jimny',
      image: {
        url: 'https://autobacsindia.com/wp-content/uploads/2023/01/maruti-jimny.jpg',
        alt: 'Maruti Jimny'
      }
    },
    {
      make: 'Jeep',
      model: 'Wrangler',
      year: 2023,
      variant: 'Rubicon',
      slug: 'jeep-wrangler',
      image: {
        url: 'https://autobacsindia.com/wp-content/uploads/2023/01/jeep-wrangler.jpg',
        alt: 'Jeep Wrangler'
      }
    },
    {
      make: 'Toyota',
      model: 'Fortuner',
      year: 2023,
      variant: 'Legender',
      slug: 'toyota-fortuner',
      image: {
        url: 'https://autobacsindia.com/wp-content/uploads/2023/01/toyota-fortuner.jpg',
        alt: 'Toyota Fortuner'
      }
    },
    {
      make: 'Volkswagen',
      model: 'Polo',
      year: 2023,
      variant: 'GT TSI',
      slug: 'volkswagen-polo',
      image: {
        url: 'https://autobacsindia.com/wp-content/uploads/2023/01/volkswagen-polo.jpg',
        alt: 'Volkswagen Polo'
      }
    },
    {
      make: 'Hyundai',
      model: 'Creta',
      year: 2023,
      variant: 'SX Opt Turbo',
      slug: 'hyundai-creta',
      image: {
        url: 'https://autobacsindia.com/wp-content/uploads/2023/01/hyundai-creta.jpg',
        alt: 'Hyundai Creta'
      }
    },
    {
      make: 'KIA',
      model: 'Seltos',
      year: 2023,
      variant: 'GTX Plus',
      slug: 'kia-seltos',
      image: {
        url: 'https://autobacsindia.com/wp-content/uploads/2023/01/kia-seltos.jpg',
        alt: 'KIA Seltos'
      }
    },
    {
      make: 'Ford',
      model: 'Endeavour',
      year: 2023,
      variant: 'Vignale',
      slug: 'ford-endeavour',
      image: {
        url: 'https://autobacsindia.com/wp-content/uploads/2023/01/ford-endeavour.jpg',
        alt: 'Ford Endeavour'
      }
    },
    {
      make: 'Audi',
      model: 'Q7',
      year: 2023,
      variant: 'Premium',
      slug: 'audi-q7',
      image: {
        url: 'https://autobacsindia.com/wp-content/uploads/2023/01/audi-q7.jpg',
        alt: 'Audi Q7'
      }
    },
    {
      make: 'BMW',
      model: 'X5',
      year: 2023,
      variant: 'M50d',
      slug: 'bmw-x5',
      image: {
        url: 'https://autobacsindia.com/wp-content/uploads/2023/01/bmw-x5.jpg',
        alt: 'BMW X5'
      }
    },
    {
      make: 'Ford',
      model: 'Ranger',
      year: 2023,
      variant: 'Wildtrak',
      slug: 'ford-ranger',
      image: {
        url: 'https://autobacsindia.com/wp-content/uploads/2023/01/ford-ranger.jpg',
        alt: 'Ford Ranger'
      }
    },
    {
      make: 'Land Rover',
      model: 'Defender',
      year: 2023,
      variant: '110 X',
      slug: 'land-rover-defender',
      image: {
        url: 'https://autobacsindia.com/wp-content/uploads/2023/01/land-rover-defender.jpg',
        alt: 'Land Rover Defender'
      }
    },
    {
      make: 'Mercedes Benz',
      model: 'G-Class',
      year: 2023,
      variant: 'G 350d',
      slug: 'mercedes-benz-g-class',
      image: {
        url: 'https://autobacsindia.com/wp-content/uploads/2023/01/mercedes-benz-g-class.jpg',
        alt: 'Mercedes Benz G-Class'
      }
    }
  ];

  try {
    // API endpoint - adjust this to match your backend server
    const apiBase = process.env.API_BASE_URL || 'http://localhost:5000/api';
    
    console.log(`Importing ${vehicles.length} vehicles to ${apiBase}/vehicles`);
    
    for (const vehicle of vehicles) {
      try {
        console.log(`Importing: ${vehicle.make} ${vehicle.model} (${vehicle.slug})`);
        
        // Check if vehicle already exists by slug
        let existingVehicle = null;
        try {
          const existingResponse = await axios.get(`${apiBase}/vehicles`);
          existingVehicle = existingResponse.data.vehicles.find(v => v.slug === vehicle.slug);
        } catch (err) {
          console.log(`Could not check for existing vehicle: ${err.message}`);
        }
        
        if (existingVehicle) {
          console.log(`  - Vehicle already exists, updating...`);
          await axios.put(`${apiBase}/vehicles/${existingVehicle._id}`, vehicle, {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${process.env.ADMIN_TOKEN || 'admin'}` // Placeholder for auth
            }
          });
        } else {
          console.log(`  - Adding new vehicle...`);
          await axios.post(`${apiBase}/vehicles`, vehicle, {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${process.env.ADMIN_TOKEN || 'admin'}` // Placeholder for auth
            }
          });
        }
        
        console.log(`  - Successfully imported ${vehicle.make} ${vehicle.model}`);
      } catch (err) {
        console.error(`  - Error importing ${vehicle.make} ${vehicle.model}:`, err.message);
        if (err.response) {
          console.error(`  - Response status: ${err.response.status}`);
          console.error(`  - Response data:`, err.response.data);
        }
      }
    }
    
    console.log('Vehicle data import completed!');
  } catch (error) {
    console.error('Error during vehicle data import:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
}

// Run the import function if this script is executed directly
if (require.main === module) {
  importVehicleData().catch(console.error);
}

module.exports = {
  importVehicleData
};const axios = require('axios');

// Function to import vehicle data to the backend
async function importVehicleData() {
  console.log('Starting vehicle data import...');

  // Sample vehicle data with image URLs
  const vehicles = [
    {
      make: 'Toyota',
      model: 'Hilux',
      year: 2023,
      variant: 'V6',
      slug: 'toyota-hilux',
      image: {
        url: 'https://autobacsindia.com/wp-content/uploads/2023/01/toyota-hilux.jpg',
        alt: 'Toyota Hilux'
      }
    },
    {
      make: 'Mahindra',
      model: 'Thar',
      year: 2023,
      variant: 'LX',
      slug: 'mahindra-thar',
      image: {
        url: 'https://autobacsindia.com/wp-content/uploads/2023/01/mahindra-thar.jpg',
        alt: 'Mahindra Thar'
      }
    },
    {
      make: 'Isuzu',
      model: 'D-Max V-Cross',
      year: 2023,
      variant: 'Z Prestige',
      slug: 'isuzu-dmax-v-cross',
      image: {
        url: 'https://autobacsindia.com/wp-content/uploads/2023/01/isuzu-dmax-v-cross.jpg',
        alt: 'Isuzu D-Max V-Cross'
      }
    },
    {
      make: 'Maruti',
      model: 'Jimny',
      year: 2023,
      variant: 'LXI',
      slug: 'maruti-jimny',
      image: {
        url: 'https://autobacsindia.com/wp-content/uploads/2023/01/maruti-jimny.jpg',
        alt: 'Maruti Jimny'
      }
    },
    {
      make: 'Jeep',
      model: 'Wrangler',
      year: 2023,
      variant: 'Rubicon',
      slug: 'jeep-wrangler',
      image: {
        url: 'https://autobacsindia.com/wp-content/uploads/2023/01/jeep-wrangler.jpg',
        alt: 'Jeep Wrangler'
      }
    },
    {
      make: 'Toyota',
      model: 'Fortuner',
      year: 2023,
      variant: 'Legender',
      slug: 'toyota-fortuner',
      image: {
        url: 'https://autobacsindia.com/wp-content/uploads/2023/01/toyota-fortuner.jpg',
        alt: 'Toyota Fortuner'
      }
    },
    {
      make: 'Volkswagen',
      model: 'Polo',
      year: 2023,
      variant: 'GT TSI',
      slug: 'volkswagen-polo',
      image: {
        url: 'https://autobacsindia.com/wp-content/uploads/2023/01/volkswagen-polo.jpg',
        alt: 'Volkswagen Polo'
      }
    },
    {
      make: 'Hyundai',
      model: 'Creta',
      year: 2023,
      variant: 'SX Opt Turbo',
      slug: 'hyundai-creta',
      image: {
        url: 'https://autobacsindia.com/wp-content/uploads/2023/01/hyundai-creta.jpg',
        alt: 'Hyundai Creta'
      }
    },
    {
      make: 'KIA',
      model: 'Seltos',
      year: 2023,
      variant: 'GTX Plus',
      slug: 'kia-seltos',
      image: {
        url: 'https://autobacsindia.com/wp-content/uploads/2023/01/kia-seltos.jpg',
        alt: 'KIA Seltos'
      }
    },
    {
      make: 'Ford',
      model: 'Endeavour',
      year: 2023,
      variant: 'Vignale',
      slug: 'ford-endeavour',
      image: {
        url: 'https://autobacsindia.com/wp-content/uploads/2023/01/ford-endeavour.jpg',
        alt: 'Ford Endeavour'
      }
    },
    {
      make: 'Audi',
      model: 'Q7',
      year: 2023,
      variant: 'Premium',
      slug: 'audi-q7',
      image: {
        url: 'https://autobacsindia.com/wp-content/uploads/2023/01/audi-q7.jpg',
        alt: 'Audi Q7'
      }
    },
    {
      make: 'BMW',
      model: 'X5',
      year: 2023,
      variant: 'M50d',
      slug: 'bmw-x5',
      image: {
        url: 'https://autobacsindia.com/wp-content/uploads/2023/01/bmw-x5.jpg',
        alt: 'BMW X5'
      }
    },
    {
      make: 'Ford',
      model: 'Ranger',
      year: 2023,
      variant: 'Wildtrak',
      slug: 'ford-ranger',
      image: {
        url: 'https://autobacsindia.com/wp-content/uploads/2023/01/ford-ranger.jpg',
        alt: 'Ford Ranger'
      }
    },
    {
      make: 'Land Rover',
      model: 'Defender',
      year: 2023,
      variant: '110 X',
      slug: 'land-rover-defender',
      image: {
        url: 'https://autobacsindia.com/wp-content/uploads/2023/01/land-rover-defender.jpg',
        alt: 'Land Rover Defender'
      }
    },
    {
      make: 'Mercedes Benz',
      model: 'G-Class',
      year: 2023,
      variant: 'G 350d',
      slug: 'mercedes-benz-g-class',
      image: {
        url: 'https://autobacsindia.com/wp-content/uploads/2023/01/mercedes-benz-g-class.jpg',
        alt: 'Mercedes Benz G-Class'
      }
    }
  ];

  try {
    // API endpoint - adjust this to match your backend server
    const apiBase = process.env.API_BASE_URL || 'http://localhost:5000/api';
    
    console.log(`Importing ${vehicles.length} vehicles to ${apiBase}/vehicles`);
    
    for (const vehicle of vehicles) {
      try {
        console.log(`Importing: ${vehicle.make} ${vehicle.model} (${vehicle.slug})`);
        
        // Check if vehicle already exists by slug
        let existingVehicle = null;
        try {
          const existingResponse = await axios.get(`${apiBase}/vehicles`);
          existingVehicle = existingResponse.data.vehicles.find(v => v.slug === vehicle.slug);
        } catch (err) {
          console.log(`Could not check for existing vehicle: ${err.message}`);
        }
        
        if (existingVehicle) {
          console.log(`  - Vehicle already exists, updating...`);
          await axios.put(`${apiBase}/vehicles/${existingVehicle._id}`, vehicle, {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${process.env.ADMIN_TOKEN || 'admin'}` // Placeholder for auth
            }
          });
        } else {
          console.log(`  - Adding new vehicle...`);
          await axios.post(`${apiBase}/vehicles`, vehicle, {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${process.env.ADMIN_TOKEN || 'admin'}` // Placeholder for auth
            }
          });
        }
        
        console.log(`  - Successfully imported ${vehicle.make} ${vehicle.model}`);
      } catch (err) {
        console.error(`  - Error importing ${vehicle.make} ${vehicle.model}:`, err.message);
        if (err.response) {
          console.error(`  - Response status: ${err.response.status}`);
          console.error(`  - Response data:`, err.response.data);
        }
      }
    }
    
    console.log('Vehicle data import completed!');
  } catch (error) {
    console.error('Error during vehicle data import:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
}

// Run the import function if this script is executed directly
if (require.main === module) {
  importVehicleData().catch(console.error);
}

module.exports = {
  importVehicleData
};