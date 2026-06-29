import mongoose from "mongoose";
import dotenv from "dotenv";
import Warehouse from "../../models/Warehouse.js";

dotenv.config();

/**
 * Seed sample warehouses for testing
 * This script creates 3 warehouses in major Indian cities
 */

const sampleWarehouses = [
  {
    name: "Mumbai Central Warehouse",
    code: "MUM-01",
    type: "warehouse",
    location: {
      address: "Plot No. 45, MIDC Industrial Area, Andheri East",
      city: "Mumbai",
      state: "Maharashtra",
      postalCode: "400093",
      country: "India",
      coordinates: {
        type: "Point",
        coordinates: [72.8777, 19.1136] // [longitude, latitude]
      }
    },
    serviceablePinCodes: [
      // Mumbai and nearby areas
      "400001", "400002", "400003", "400004", "400005", "400006", "400007",
      "400008", "400009", "400010", "400011", "400012", "400013", "400014",
      "400015", "400016", "400017", "400018", "400019", "400020", "400051",
      "400052", "400053", "400054", "400055", "400056", "400057", "400058",
      "400059", "400060", "400061", "400062", "400063", "400064", "400065",
      "400066", "400067", "400068", "400069", "400070", "400071", "400072",
      "400074", "400075", "400076", "400077", "400078", "400079", "400080",
      "400081", "400082", "400083", "400084", "400085", "400086", "400087",
      "400088", "400089", "400090", "400091", "400092", "400093", "400094",
      "400095", "400096", "400097", "400098", "400099", "400101", "400102",
      "400103", "400104",
      // Thane
      "401101", "401102", "401103", "401104", "401105", "401107", "401201",
      "401202", "401203", "401204", "401205", "401206", "401207", "401208",
      // Navi Mumbai
      "400701", "400702", "400703", "400704", "400705", "400706", "400707",
      "400708", "400709", "400710"
    ],
    operationalStatus: "active",
    operationalHours: {
      monday: { open: "09:00", close: "18:00" },
      tuesday: { open: "09:00", close: "18:00" },
      wednesday: { open: "09:00", close: "18:00" },
      thursday: { open: "09:00", close: "18:00" },
      friday: { open: "09:00", close: "18:00" },
      saturday: { open: "09:00", close: "14:00" },
      sunday: { open: "Closed", close: "Closed" }
    },
    contactInfo: {
      phone: "+91-22-2345-6789",
      email: "mumbai@autobacs.in",
      manager: "Rajesh Kumar"
    },
    capacity: 15000,
    isActive: true
  },
  {
    name: "Delhi NCR Distribution Center",
    code: "DEL-01",
    type: "warehouse",
    location: {
      address: "Sector 18, IMT Manesar",
      city: "Gurugram",
      state: "Haryana",
      postalCode: "122050",
      country: "India",
      coordinates: {
        type: "Point",
        coordinates: [76.9388, 28.3670]
      }
    },
    serviceablePinCodes: [
      // Delhi
      "110001", "110002", "110003", "110004", "110005", "110006", "110007",
      "110008", "110009", "110010", "110011", "110012", "110013", "110014",
      "110015", "110016", "110017", "110018", "110019", "110020", "110021",
      "110022", "110023", "110024", "110025", "110026", "110027", "110028",
      "110029", "110030", "110031", "110032", "110033", "110034", "110035",
      "110036", "110037", "110038", "110039", "110040", "110041", "110042",
      "110043", "110044", "110045", "110046", "110047", "110048", "110049",
      "110051", "110052", "110053", "110054", "110055", "110056", "110057",
      "110058", "110059", "110060", "110061", "110062", "110063", "110064",
      "110065", "110066", "110067", "110068", "110069", "110070", "110071",
      "110072", "110073", "110074", "110075", "110076", "110077", "110078",
      "110079", "110080", "110081", "110082", "110083", "110084", "110085",
      "110086", "110087", "110088", "110089", "110091", "110092", "110093",
      "110094", "110095", "110096",
      // Noida
      "201301", "201302", "201303", "201304", "201305", "201306", "201307",
      "201308", "201309", "201310",
      // Gurgaon
      "122001", "122002", "122003", "122004", "122005", "122015", "122016",
      "122017", "122018", "122050", "122051", "122052",
      // Faridabad
      "121001", "121002", "121003", "121004", "121005", "121006", "121007",
      "121008", "121009", "121010"
    ],
    operationalStatus: "active",
    operationalHours: {
      monday: { open: "09:00", close: "18:00" },
      tuesday: { open: "09:00", close: "18:00" },
      wednesday: { open: "09:00", close: "18:00" },
      thursday: { open: "09:00", close: "18:00" },
      friday: { open: "09:00", close: "18:00" },
      saturday: { open: "09:00", close: "14:00" },
      sunday: { open: "Closed", close: "Closed" }
    },
    contactInfo: {
      phone: "+91-124-456-7890",
      email: "delhi@autobacs.in",
      manager: "Amit Sharma"
    },
    capacity: 20000,
    isActive: true
  },
  {
    name: "Bangalore Tech Hub Warehouse",
    code: "BLR-01",
    type: "warehouse",
    location: {
      address: "Plot 12, Electronics City Phase 1",
      city: "Bangalore",
      state: "Karnataka",
      postalCode: "560100",
      country: "India",
      coordinates: {
        type: "Point",
        coordinates: [77.6653, 12.8456]
      }
    },
    serviceablePinCodes: [
      // Bangalore
      "560001", "560002", "560003", "560004", "560005", "560006", "560007",
      "560008", "560009", "560010", "560011", "560012", "560013", "560014",
      "560015", "560016", "560017", "560018", "560019", "560020", "560021",
      "560022", "560023", "560024", "560025", "560026", "560027", "560028",
      "560029", "560030", "560031", "560032", "560033", "560034", "560035",
      "560036", "560037", "560038", "560039", "560040", "560041", "560042",
      "560043", "560045", "560046", "560047", "560048", "560049", "560050",
      "560051", "560052", "560053", "560054", "560055", "560056", "560057",
      "560058", "560059", "560060", "560061", "560062", "560063", "560064",
      "560065", "560066", "560067", "560068", "560069", "560070", "560071",
      "560072", "560073", "560074", "560075", "560076", "560077", "560078",
      "560079", "560080", "560081", "560082", "560083", "560084", "560085",
      "560086", "560087", "560093", "560094", "560095", "560096", "560097",
      "560098", "560099", "560100",
      // Nearby areas
      "560103", "560104", "560105", "560107", "560108", "560109", "560110",
      "560111", "560112", "560113", "560114"
    ],
    operationalStatus: "active",
    operationalHours: {
      monday: { open: "09:00", close: "18:00" },
      tuesday: { open: "09:00", close: "18:00" },
      wednesday: { open: "09:00", close: "18:00" },
      thursday: { open: "09:00", close: "18:00" },
      friday: { open: "09:00", close: "18:00" },
      saturday: { open: "09:00", close: "14:00" },
      sunday: { open: "Closed", close: "Closed" }
    },
    contactInfo: {
      phone: "+91-80-2345-6789",
      email: "bangalore@autobacs.in",
      manager: "Priya Nair"
    },
    capacity: 12000,
    isActive: true
  }
];

async function seedWarehouses() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✓ Connected to MongoDB");

    // Clear existing warehouses
    await Warehouse.deleteMany({});
    console.log("✓ Cleared existing warehouses");

    // Insert new warehouses
    const insertedWarehouses = await Warehouse.insertMany(sampleWarehouses);
    console.log(`✓ Inserted ${insertedWarehouses.length} warehouses`);

    // Display summary
    console.log("\n--- Warehouses Summary ---");
    for (const warehouse of insertedWarehouses) {
      console.log(`\n${warehouse.name} (${warehouse.code}):`);
      console.log(`  - Location: ${warehouse.location.city}, ${warehouse.location.state}`);
      console.log(`  - Coordinates: ${warehouse.location.coordinates.coordinates[1]}, ${warehouse.location.coordinates.coordinates[0]}`);
      console.log(`  - Serviceable PIN Codes: ${warehouse.serviceablePinCodes.length}`);
      console.log(`  - Capacity: ${warehouse.capacity} units`);
      console.log(`  - Contact: ${warehouse.contactInfo.phone}`);
      console.log(`  - Manager: ${warehouse.contactInfo.manager}`);
    }
    console.log("\n✓ Seed completed successfully!");
    
    process.exit(0);
  } catch (error) {
    console.error("✗ Seed failed:", error);
    process.exit(1);
  }
}

// Run seeder
seedWarehouses();
