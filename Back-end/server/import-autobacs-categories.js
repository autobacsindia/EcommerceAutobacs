import mongoose from "mongoose";
import dotenv from "dotenv";
import Category from "./models/Category.js";

dotenv.config();

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// Define the complete category structure based on autobacsindia.com
const categoryStructure = [
  {
    name: "Other",
    slug: "other",
    description: "Miscellaneous categories and items",
    order: 1
  },
  {
    name: "Accessories",
    slug: "accessories",
    description: "General automotive accessories and miscellaneous items",
    order: 2
  },
  {
    name: "Exterior",
    slug: "exterior",
    description: "External modifications and accessories for your vehicle",
    order: 3
  },
  {
    name: "Interior",
    slug: "interior",
    description: "Internal cabin upgrades and accessories",
    order: 4
  },
  {
    name: "Performance",
    slug: "performance",
    description: "Performance enhancement parts and upgrades",
    order: 5
  },
  {
    name: "Suspension",
    slug: "suspension",
    description: "Suspension systems and components",
    order: 6
  },
  {
    name: "Lighting",
    slug: "lighting",
    description: "Headlights, taillights, and lighting accessories",
    order: 7
  },
  {
    name: "Body Kits",
    slug: "body-kits",
    description: "Complete body kits and body panels",
    order: 8
  },
  {
    name: "Protection Kit",
    slug: "protection-kit",
    description: "Vehicle protection systems and components",
    order: 9
  },
  {
    name: "Roof Top",
    slug: "roof-top",
    description: "Roof-mounted accessories and equipment",
    order: 10
  },
  {
    name: "Portable Fridge",
    slug: "portable-fridge",
    description: "Mobile refrigeration units for vehicles",
    order: 11
  },
  {
    name: "Winch",
    slug: "winch",
    description: "Recovery winches and related equipment",
    order: 12
  },
  {
    name: "X-JACK",
    slug: "x-jack",
    description: "Specialized lifting equipment",
    order: 13
  }
];

// Define subcategories with parent relationships
const subCategoryStructure = [
  // Accessories subcategories
  {
    name: "air compressor",
    slug: "air-compressor",
    parent: "Accessories",
    order: 1
  },
  {
    name: "aluminum hood",
    slug: "aluminum-hood",
    parent: "Accessories",
    order: 2
  },
  {
    name: "awning",
    slug: "awning",
    parent: "Accessories",
    order: 3
  },
  {
    name: "Back cover canyon lid",
    slug: "back-cover-canyon-lid",
    parent: "Accessories",
    order: 4
  },
  {
    name: "BONNET ENGINE HOOD COVER",
    slug: "bonnet-engine-hood-cover",
    parent: "Accessories",
    order: 5
  },
  {
    name: "Dash cam",
    slug: "dash-cam",
    parent: "Accessories",
    order: 6
  },
  {
    name: "Digital Climate Control Panel",
    slug: "digital-climate-control-panel",
    parent: "Accessories",
    order: 7
  },
  {
    name: "door cladding",
    slug: "door-cladding",
    parent: "Accessories",
    order: 8
  },
  {
    name: "Dual Battery Manager",
    slug: "dual-battery-manager",
    parent: "Accessories",
    order: 9
  },
  {
    name: "Dual Battery Monitor Display",
    slug: "dual-battery-monitor-display",
    parent: "Accessories",
    order: 10
  },
  {
    name: "Engine Bay and Transmission",
    slug: "engine-bay-transmission",
    parent: "Accessories",
    order: 11
  },
  {
    name: "Engine Hood Cover",
    slug: "engine-hood-cover",
    parent: "Accessories",
    order: 12
  },
  {
    name: "filter",
    slug: "filter",
    parent: "Accessories",
    order: 13
  },
  {
    name: "Generic Driving Light Wiring Harness",
    slug: "generic-driving-light-wiring-harness",
    parent: "Accessories",
    order: 14
  },
  {
    name: "intercooler",
    slug: "intercooler",
    parent: "Accessories",
    order: 15
  },
  {
    name: "jerry can",
    slug: "jerry-can",
    parent: "Accessories",
    order: 16
  },
  {
    name: "Key Case",
    slug: "key-case",
    parent: "Accessories",
    order: 17
  },
  {
    name: "Ladder",
    slug: "ladder",
    parent: "Accessories",
    order: 18
  },
  {
    name: "lunar carrier",
    slug: "lunar-carrier",
    parent: "Accessories",
    order: 19
  },
  {
    name: "metal pedal kit",
    slug: "metal-pedal-kit",
    parent: "Accessories",
    order: 20
  },
  {
    name: "METAL STAMPED ALUMINIUM HOOD",
    slug: "metal-stamped-aluminium-hood",
    parent: "Accessories",
    order: 21
  },
  {
    name: "Portable Battery Box",
    slug: "portable-battery-box",
    parent: "Accessories",
    order: 22
  },
  {
    name: "portable fridge",
    slug: "portable-fridge-sub",
    parent: "Accessories",
    order: 23
  },
  {
    name: "Reco-Traks",
    slug: "reco-traks",
    parent: "Accessories",
    order: 24
  },
  {
    name: "recovory boards",
    slug: "recovory-boards",
    parent: "Accessories",
    order: 25
  },
  {
    name: "Roof cross bar",
    slug: "roof-cross-bar",
    parent: "Accessories",
    order: 26
  },
  {
    name: "roof top tent",
    slug: "roof-top-tent",
    parent: "Accessories",
    order: 27
  },
  {
    name: "Smart Key",
    slug: "smart-key",
    parent: "Accessories",
    order: 28
  },
  {
    name: "snatch straps",
    slug: "snatch-straps",
    parent: "Accessories",
    order: 29
  },
  {
    name: "soft cover",
    slug: "soft-cover",
    parent: "Accessories",
    order: 30
  },
  {
    name: "Stepney Cover",
    slug: "stepney-cover",
    parent: "Accessories",
    order: 31
  },
  {
    name: "tow bar",
    slug: "tow-bar",
    parent: "Accessories",
    order: 32
  },
  {
    name: "towing mirror",
    slug: "towing-mirror",
    parent: "Accessories",
    order: 33
  },
  {
    name: "Underbody Protection Engine Bay and Transmission Protector",
    slug: "underbody-protection-engine-bay-transmission-protector",
    parent: "Accessories",
    order: 34
  },
  {
    name: "valvetronics exhaust",
    slug: "valvetronics-exhaust",
    parent: "Accessories",
    order: 35
  },
  {
    name: "Water Tank",
    slug: "water-tank",
    parent: "Accessories",
    order: 36
  },
  {
    name: "windshield scoop cover",
    slug: "windshield-scoop-cover",
    parent: "Accessories",
    order: 37
  },

  // Exterior subcategories
  {
    name: "Body Kits",
    slug: "exterior-body-kits",
    parent: "Exterior",
    order: 1
  },
  {
    name: "Rad Pathfinder Components",
    slug: "rad-pathfinder-components",
    parent: "Exterior",
    order: 2
  },
  {
    name: "Raptor Kit",
    slug: "raptor-kit",
    parent: "Exterior",
    order: 3
  },
  {
    name: "Body Parts",
    slug: "body-parts",
    parent: "Exterior",
    order: 4
  },
  {
    name: "Bonnet",
    slug: "bonnet",
    parent: "Exterior",
    order: 5
  },
  {
    name: "Bonnet Hood",
    slug: "bonnet-hood",
    parent: "Exterior",
    order: 6
  },
  {
    name: "Bumper",
    slug: "bumper",
    parent: "Exterior",
    order: 7
  },
  {
    name: "Metal bumber",
    slug: "metal-bumber",
    parent: "Exterior",
    order: 8
  },
  {
    name: "Diffusers",
    slug: "diffusers",
    parent: "Exterior",
    order: 9
  },
  {
    name: "Fender Flares",
    slug: "fender-flares",
    parent: "Exterior",
    order: 10
  },
  {
    name: "Front Lip",
    slug: "front-lip",
    parent: "Exterior",
    order: 11
  },
  {
    name: "Grill",
    slug: "grill",
    parent: "Exterior",
    order: 12
  },
  {
    name: "Front Bumper Grill",
    slug: "front-bumper-grill",
    parent: "Exterior",
    order: 13
  },
  {
    name: "Mirrors",
    slug: "mirrors",
    parent: "Exterior",
    order: 14
  },
  {
    name: "rear view mirrors with LED",
    slug: "rear-view-mirrors-with-led",
    parent: "Exterior",
    order: 15
  },
  {
    name: "Roll Bar",
    slug: "roll-bar",
    parent: "Exterior",
    order: 16
  },
  {
    name: "Side Steps",
    slug: "side-steps",
    parent: "Exterior",
    order: 17
  },
  {
    name: "automatic side steps",
    slug: "automatic-side-steps",
    parent: "Exterior",
    order: 18
  },
  {
    name: "electric side steps",
    slug: "electric-side-steps",
    parent: "Exterior",
    order: 19
  },
  {
    name: "Wiper Blade",
    slug: "wiper-blade",
    parent: "Exterior",
    order: 20
  },
  {
    name: "dickey shutter",
    slug: "dickey-shutter",
    parent: "Exterior",
    order: 21
  },
  {
    name: "dicky shutter",
    slug: "dicky-shutter",
    parent: "Exterior",
    order: 22
  },
  {
    name: "Roof Rack",
    slug: "roof-rack",
    parent: "Exterior",
    order: 23
  },
  {
    name: "Roof Rail",
    slug: "roof-rail",
    parent: "Exterior",
    order: 24
  },
  {
    name: "Spoiler",
    slug: "spoiler",
    parent: "Exterior",
    order: 25
  },
  {
    name: "Automatic Deployable Spoiler",
    slug: "automatic-deployable-spoiler",
    parent: "Exterior",
    order: 26
  },
  {
    name: "Exterior Accessories",
    slug: "exterior-accessories",
    parent: "Exterior",
    order: 27
  },
  {
    name: "jerry can mounting",
    slug: "jerry-can-mounting",
    parent: "Exterior",
    order: 28
  },
  {
    name: "roof carrier",
    slug: "roof-carrier",
    parent: "Exterior",
    order: 29
  },
  {
    name: "switch panel accesories",
    slug: "switch-panel-accesories",
    parent: "Exterior",
    order: 30
  },
  {
    name: "tryre carrier",
    slug: "tryre-carrier",
    parent: "Exterior",
    order: 31
  },
  {
    name: "facelifrt",
    slug: "facelifrt",
    parent: "Exterior",
    order: 32
  },
  {
    name: "FaceLift",
    slug: "face-lift",
    parent: "Exterior",
    order: 33
  },
  {
    name: "Facelift Conversion Kit",
    slug: "facelift-conversion-kit",
    parent: "Exterior",
    order: 34
  },
  {
    name: "Fender Flare",
    slug: "fender-flare",
    parent: "Exterior",
    order: 35
  },
  {
    name: "fenders Bolt on fitment",
    slug: "fenders-bolt-on-fitment",
    parent: "Exterior",
    order: 36
  },
  {
    name: "Flexy Flares",
    slug: "flexy-flares",
    parent: "Exterior",
    order: 37
  },
  {
    name: "floor mat",
    slug: "floor-mat",
    parent: "Exterior",
    order: 38
  },
  {
    name: "Foam Cell Shock Absorbers",
    slug: "foam-cell-shock-absorbers",
    parent: "Exterior",
    order: 39
  },
  {
    name: "Foot Step",
    slug: "foot-step",
    parent: "Exterior",
    order: 40
  },
  {
    name: "Front & Back protection kit",
    slug: "front-back-protection-kit",
    parent: "Exterior",
    order: 41
  },
  {
    name: "Front Grill",
    slug: "front-grill",
    parent: "Exterior",
    order: 42
  },
  {
    name: "Front hood aluminium Bonnet",
    slug: "front-hood-aluminium-bonnet",
    parent: "Exterior",
    order: 43
  },
  {
    name: "front leveling kit",
    slug: "front-leveling-kit",
    parent: "Exterior",
    order: 44
  },
  {
    name: "front recovery points",
    slug: "front-recovery-points",
    parent: "Exterior",
    order: 45
  },
  {
    name: "front splitter",
    slug: "front-splitter",
    parent: "Exterior",
    order: 46
  },
  {
    name: "Gear Knob",
    slug: "gear-knob",
    parent: "Exterior",
    order: 47
  },
  {
    name: "Gear Knob Cover",
    slug: "gear-knob-cover",
    parent: "Exterior",
    order: 48
  },
  {
    name: "GECKO RACING",
    slug: "gecko-racing",
    parent: "Exterior",
    order: 49
  },
  {
    name: "GR door beading",
    slug: "gr-door-beading",
    parent: "Exterior",
    order: 50
  },
  {
    name: "Grab Handle",
    slug: "grab-handle",
    parent: "Exterior",
    order: 51
  },
  {
    name: "Hood Light Bug Visor",
    slug: "hood-light-bug-visor",
    parent: "Exterior",
    order: 52
  },
  {
    name: "HUD",
    slug: "hud",
    parent: "Exterior",
    order: 53
  },
  {
    name: "Hydraulic Bonnet Strut",
    slug: "hydraulic-bonnet-strut",
    parent: "Exterior",
    order: 54
  },
  {
    name: "IceCube Drawer Fridge",
    slug: "icecube-drawer-fridge",
    parent: "Exterior",
    order: 55
  },
  {
    name: "Infotainment System",
    slug: "infotainment-system",
    parent: "Exterior",
    order: 56
  },
  {
    name: "Intercooler",
    slug: "intercooler-exterior",
    parent: "Exterior",
    order: 57
  },

  // Interior subcategories
  {
    name: "Arc Vents",
    slug: "arc-vents",
    parent: "Interior",
    order: 1
  },
  {
    name: "Dash Kits",
    slug: "dash-kits",
    parent: "Interior",
    order: 2
  },
  {
    name: "Digital instrumental cluster",
    slug: "digital-instrumental-cluster",
    parent: "Interior",
    order: 3
  },
  {
    name: "Floor Mats",
    slug: "floor-mats",
    parent: "Interior",
    order: 4
  },
  {
    name: "Seat",
    slug: "seat",
    parent: "Interior",
    order: 5
  },
  {
    name: "Seat Cover",
    slug: "seat-cover",
    parent: "Interior",
    order: 6
  },
  {
    name: "Steering Wheel",
    slug: "steering-wheel",
    parent: "Interior",
    order: 7
  },
  {
    name: "steering trim",
    slug: "steering-trim",
    parent: "Interior",
    order: 8
  },
  {
    name: "Interior carbon trims",
    slug: "interior-carbon-trims",
    parent: "Interior",
    order: 9
  },
  {
    name: "Jerry Can",
    slug: "jerry-can-interior",
    parent: "Interior",
    order: 10
  },
  {
    name: "jerry can mound",
    slug: "jerry-can-mound",
    parent: "Interior",
    order: 11
  },
  {
    name: "Keycase",
    slug: "keycase",
    parent: "Interior",
    order: 12
  },
  {
    name: "Kinetic Recovery Rope",
    slug: "kinetic-recovery-rope",
    parent: "Interior",
    order: 13
  },
  {
    name: "Laser Projector",
    slug: "laser-projector",
    parent: "Interior",
    order: 14
  },
  {
    name: "Leveling Kit",
    slug: "leveling-kit",
    parent: "Interior",
    order: 15
  },
  {
    name: "lift kit",
    slug: "lift-kit",
    parent: "Interior",
    order: 16
  },
  {
    name: "Light Mount Clamp",
    slug: "light-mount-clamp",
    parent: "Interior",
    order: 17
  },

  // Lighting subcategories
  {
    name: "Ambient Lights",
    slug: "ambient-lights",
    parent: "Lighting",
    order: 1
  },
  {
    name: "Auxillary Exterior Light",
    slug: "auxillary-exterior-light",
    parent: "Lighting",
    order: 2
  },
  {
    name: "handheld light",
    slug: "handheld-light",
    parent: "Lighting",
    order: 3
  },
  {
    name: "LED Driving POD Lights",
    slug: "led-driving-pod-lights",
    parent: "Lighting",
    order: 4
  },
  {
    name: "Auxillary Stop Light",
    slug: "auxillary-stop-light",
    parent: "Lighting",
    order: 5
  },
  {
    name: "Bar Light",
    slug: "bar-light",
    parent: "Lighting",
    order: 6
  },
  {
    name: "Bonnet Light Mount",
    slug: "bonnet-light-mount",
    parent: "Lighting",
    order: 7
  },
  {
    name: "Bulb",
    slug: "bulb",
    parent: "Lighting",
    order: 8
  },
  {
    name: "Car Lighting",
    slug: "car-lighting",
    parent: "Lighting",
    order: 9
  },
  {
    name: "Daytime Running Light",
    slug: "daytime-running-light",
    parent: "Lighting",
    order: 10
  },
  {
    name: "Dicky Light",
    slug: "dicky-light",
    parent: "Lighting",
    order: 11
  },
  {
    name: "driving lights",
    slug: "driving-lights",
    parent: "Lighting",
    order: 12
  },
  {
    name: "driving lights cover",
    slug: "driving-lights-cover",
    parent: "Lighting",
    order: 13
  },
  {
    name: "Driving lights over",
    slug: "driving-lights-over",
    parent: "Lighting",
    order: 14
  },
  {
    name: "DRL",
    slug: "drl",
    parent: "Lighting",
    order: 15
  },
  {
    name: "Fog Lamp",
    slug: "fog-lamp",
    parent: "Lighting",
    order: 16
  },
  {
    name: "Fog Lamps",
    slug: "fog-lamps",
    parent: "Lighting",
    order: 17
  },
  {
    name: "Headlight",
    slug: "headlight",
    parent: "Lighting",
    order: 18
  },
  {
    name: "projector headlights",
    slug: "projector-headlights",
    parent: "Lighting",
    order: 19
  },
  {
    name: "Indicator",
    slug: "indicator",
    parent: "Lighting",
    order: 20
  },
  {
    name: "LED lights",
    slug: "led-lights",
    parent: "Lighting",
    order: 21
  },
  {
    name: "Lightbar",
    slug: "lightbar",
    parent: "Lighting",
    order: 22
  },
  {
    name: "Marker LED",
    slug: "marker-led",
    parent: "Lighting",
    order: 23
  },
  {
    name: "Number Plate Light",
    slug: "number-plate-light",
    parent: "Lighting",
    order: 24
  },
  {
    name: "Passenger Compartment Light",
    slug: "passenger-compartment-light",
    parent: "Lighting",
    order: 25
  },
  {
    name: "Pillar Light",
    slug: "pillar-light",
    parent: "Lighting",
    order: 26
  },
  {
    name: "piller lights",
    slug: "piller-lights",
    parent: "Lighting",
    order: 27
  },
  {
    name: "Rear Light",
    slug: "rear-light",
    parent: "Lighting",
    order: 28
  },
  {
    name: "Roof Light",
    slug: "roof-light",
    parent: "Lighting",
    order: 29
  },
  {
    name: "Tail Light",
    slug: "tail-light",
    parent: "Lighting",
    order: 30
  },

  // Performance subcategories
  {
    name: "Air Filters",
    slug: "air-filters",
    parent: "Performance",
    order: 1
  },
  {
    name: "Air Intake Systems",
    slug: "air-intake-systems",
    parent: "Performance",
    order: 2
  },
  {
    name: "Coilovers",
    slug: "coilovers",
    parent: "Performance",
    order: 3
  },
  {
    name: "Cooling System",
    slug: "cooling-system",
    parent: "Performance",
    order: 4
  },
  {
    name: "Exhaust",
    slug: "exhaust",
    parent: "Performance",
    order: 5
  },
  {
    name: "Lift Kit",
    slug: "lift-kit-performance",
    parent: "Performance",
    order: 6
  },
  {
    name: "switch panel system",
    slug: "switch-panel-system",
    parent: "Performance",
    order: 7
  },
  {
    name: "throttle controllers",
    slug: "throttle-controllers",
    parent: "Performance",
    order: 8
  },
  {
    name: "Turbo",
    slug: "turbo",
    parent: "Performance",
    order: 9
  },

  // Suspension subcategories
  {
    name: "Air Suspension",
    slug: "air-suspension",
    parent: "Suspension",
    order: 1
  },
  {
    name: "coil springs",
    slug: "coil-springs",
    parent: "Suspension",
    order: 2
  },
  {
    name: "Coil Suspension",
    slug: "coil-suspension",
    parent: "Suspension",
    order: 3
  },
  {
    name: "Foam Cell Shock Absorbers",
    slug: "foam-cell-shock-absorbers-suspension",
    parent: "Suspension",
    order: 4
  },
  {
    name: "Load Helper Spring Kit",
    slug: "load-helper-spring-kit",
    parent: "Suspension",
    order: 5
  },
  {
    name: "Lowering Coil Springs",
    slug: "lowering-coil-springs",
    parent: "Suspension",
    order: 6
  },
  {
    name: "Nitro Gas Shock Absorbers",
    slug: "nitro-gas-shock-absorbers",
    parent: "Suspension",
    order: 7
  },
  {
    name: "Nitro Gas Suspension",
    slug: "nitro-gas-suspension",
    parent: "Suspension",
    order: 8
  },
  {
    name: "Shock Absorbers",
    slug: "shock-absorbers",
    parent: "Suspension",
    order: 9
  },
  {
    name: "suspension",
    slug: "suspension-sub",
    parent: "Suspension",
    order: 10
  },
  {
    name: "Suspension Kit",
    slug: "suspension-kit",
    parent: "Suspension",
    order: 11
  },
  {
    name: "Suspension Lift Kit",
    slug: "suspension-lift-kit",
    parent: "Suspension",
    order: 12
  },
  {
    name: "Upper Control Arms",
    slug: "upper-control-arms",
    parent: "Suspension",
    order: 13
  },

  // Body Kits subcategories
  {
    name: "Body kit car bumber",
    slug: "body-kit-car-bumber",
    parent: "Body Kits",
    order: 1
  },
  {
    name: "Body Protection Plate Patch",
    slug: "body-protection-plate-patch",
    parent: "Body Kits",
    order: 2
  },
  {
    name: "bonnet",
    slug: "bonnet-body-kits",
    parent: "Body Kits",
    order: 3
  },
  {
    name: "Bonnet Air Vent",
    slug: "bonnet-air-vent",
    parent: "Body Kits",
    order: 4
  },
  {
    name: "bonnet Engine Hood Cover",
    slug: "bonnet-engine-hood-cover-body-kits",
    parent: "Body Kits",
    order: 5
  },
  {
    name: "bonnet hood",
    slug: "bonnet-hood-body-kits",
    parent: "Body Kits",
    order: 6
  },
  {
    name: "bonnet hood air vent",
    slug: "bonnet-hood-air-vent",
    parent: "Body Kits",
    order: 7
  },
  {
    name: "bonnet hood visor",
    slug: "bonnet-hood-visor",
    parent: "Body Kits",
    order: 8
  },
  {
    name: "Bonnet Scoop",
    slug: "bonnet-scoop",
    parent: "Body Kits",
    order: 9
  },
  {
    name: "Lip Kit",
    slug: "lip-kit",
    parent: "Body Kits",
    order: 10
  },
  {
    name: "Splitter",
    slug: "splitter",
    parent: "Body Kits",
    order: 11
  },
  {
    name: "spoiler",
    slug: "spoiler-body-kits",
    parent: "Body Kits",
    order: 12
  },
  {
    name: "Spoiler Lip",
    slug: "spoiler-lip",
    parent: "Body Kits",
    order: 13
  },
  {
    name: "Sports Bar",
    slug: "sports-bar",
    parent: "Body Kits",
    order: 14
  },
  {
    name: "tailgate spoiler",
    slug: "tailgate-spoiler",
    parent: "Body Kits",
    order: 15
  },

  // Protection Kit subcategories
  {
    name: "Balance Arms",
    slug: "balance-arms",
    parent: "Protection Kit",
    order: 1
  },
  {
    name: "Bash Plate",
    slug: "bash-plate",
    parent: "Protection Kit",
    order: 2
  },
  {
    name: "Bed Liner",
    slug: "bed-liner",
    parent: "Protection Kit",
    order: 3
  },
  {
    name: "Bed Rack",
    slug: "bed-rack",
    parent: "Protection Kit",
    order: 4
  },
  {
    name: "Canopy",
    slug: "canopy",
    parent: "Protection Kit",
    order: 5
  },
  {
    name: "Carbon Fiber Rear Wing Spoiler",
    slug: "carbon-fiber-rear-wing-spoiler",
    parent: "Protection Kit",
    order: 6
  },
  {
    name: "Care & Decor",
    slug: "care-decor",
    parent: "Protection Kit",
    order: 7
  },
  {
    name: "Vehicle Covers",
    slug: "vehicle-covers",
    parent: "Protection Kit",
    order: 8
  },
  {
    name: "Tonneau Covers",
    slug: "tonneau-covers",
    parent: "Protection Kit",
    order: 9
  },
  {
    name: "Vehicle Decor",
    slug: "vehicle-decor",
    parent: "Protection Kit",
    order: 10
  },
  {
    name: "Vehicle Air Fresheners",
    slug: "vehicle-air-fresheners",
    parent: "Protection Kit",
    order: 11
  },
  {
    name: "Vehicle Paint",
    slug: "vehicle-paint",
    parent: "Protection Kit",
    order: 12
  },
  {
    name: "Center Console",
    slug: "center-console",
    parent: "Protection Kit",
    order: 13
  },
  {
    name: "Center spoiler garnish",
    slug: "center-spoiler-garnish",
    parent: "Protection Kit",
    order: 14
  },
  {
    name: "Climate Control",
    slug: "climate-control",
    parent: "Protection Kit",
    order: 15
  },
  {
    name: "COASTA",
    slug: "coasta",
    parent: "Protection Kit",
    order: 16
  },
  {
    name: "Compressors",
    slug: "compressors",
    parent: "Protection Kit",
    order: 17
  },
  {
    name: "Connecting Center Light",
    slug: "connecting-center-light",
    parent: "Protection Kit",
    order: 18
  },
  {
    name: "Conversion Kit",
    slug: "conversion-kit",
    parent: "Protection Kit",
    order: 19
  },
  {
    name: "conversion trims",
    slug: "conversion-trims",
    parent: "Protection Kit",
    order: 20
  },
  {
    name: "Convertible Soft Top",
    slug: "convertible-soft-top",
    parent: "Protection Kit",
    order: 21
  },
  {
    name: "cross bar",
    slug: "cross-bar",
    parent: "Protection Kit",
    order: 22
  },
  {
    name: "Crystal",
    slug: "crystal",
    parent: "Protection Kit",
    order: 23
  },
  {
    name: "Crystal gear knob",
    slug: "crystal-gear-knob",
    parent: "Protection Kit",
    order: 24
  },
  {
    name: "Dicky Garnish",
    slug: "dicky-garnish",
    parent: "Protection Kit",
    order: 25
  },
  {
    name: "Differential Drop Kit",
    slug: "differential-drop-kit",
    parent: "Protection Kit",
    order: 26
  },
  {
    name: "diffuser",
    slug: "diffuser",
    parent: "Protection Kit",
    order: 27
  },
  {
    name: "Door Hinge",
    slug: "door-hinge",
    parent: "Protection Kit",
    order: 28
  },
  {
    name: "Door Switch Panel",
    slug: "door-switch-panel",
    parent: "Protection Kit",
    order: 29
  },
  {
    name: "Door Visor",
    slug: "door-visor",
    parent: "Protection Kit",
    order: 30
  },
  {
    name: "driving light protective covers",
    slug: "driving-light-protective-covers",
    parent: "Protection Kit",
    order: 31
  },
  {
    name: "Electronic Exhaust System",
    slug: "electronic-exhaust-system",
    parent: "Protection Kit",
    order: 32
  },
  {
    name: "Door Visor",
    slug: "door-visor-protection",
    parent: "Protection Kit",
    order: 33
  },

  // Roof Top subcategories
  {
    name: "Loop bar",
    slug: "loop-bar",
    parent: "Roof Top",
    order: 1
  },
  {
    name: "Lunar Carrier",
    slug: "lunar-carrier-roof",
    parent: "Roof Top",
    order: 2
  },
  {
    name: "metal canopy",
    slug: "metal-canopy",
    parent: "Roof Top",
    order: 3
  },
  {
    name: "Meter Console",
    slug: "meter-console",
    parent: "Roof Top",
    order: 4
  },
  {
    name: "Mirror Cover",
    slug: "mirror-cover",
    parent: "Roof Top",
    order: 5
  },
  {
    name: "Mirros",
    slug: "mirros",
    parent: "Roof Top",
    order: 6
  },
  {
    name: "modular roof carrier",
    slug: "modular-roof-carrier",
    parent: "Roof Top",
    order: 7
  },
  {
    name: "mud flap",
    slug: "mud-flap",
    parent: "Roof Top",
    order: 8
  },
  {
    name: "Mud Tracks",
    slug: "mud-tracks",
    parent: "Roof Top",
    order: 9
  },
  {
    name: "Neck Rest",
    slug: "neck-rest",
    parent: "Roof Top",
    order: 10
  },
  {
    name: "Off Road Accessories",
    slug: "off-road-accessories",
    parent: "Roof Top",
    order: 11
  },
  {
    name: "Overhead Storage Mesh",
    slug: "overhead-storage-mesh",
    parent: "Roof Top",
    order: 12
  },
  {
    name: "Overhead Storage Net",
    slug: "overhead-storage-net",
    parent: "Roof Top",
    order: 13
  },
  {
    name: "Power Bank",
    slug: "power-bank",
    parent: "Roof Top",
    order: 14
  },
  {
    name: "quick step",
    slug: "quick-step",
    parent: "Roof Top",
    order: 15
  },
  {
    name: "Recovery Point",
    slug: "recovery-point",
    parent: "Roof Top",
    order: 16
  },
  {
    name: "Recovery Rope",
    slug: "recovery-rope",
    parent: "Roof Top",
    order: 17
  },
  {
    name: "recovory damper",
    slug: "recovory-damper",
    parent: "Roof Top",
    order: 18
  },
  {
    name: "Refrigerator",
    slug: "refrigerator",
    parent: "Roof Top",
    order: 19
  },
  {
    name: "Revival Kit",
    slug: "revival-kit",
    parent: "Roof Top",
    order: 20
  },
  {
    name: "Rock Slider",
    slug: "rock-slider",
    parent: "Roof Top",
    order: 21
  },
  {
    name: "Roll Bar Cage Storage Bag",
    slug: "roll-bar-cage-storage-bag",
    parent: "Roof Top",
    order: 22
  },
  {
    name: "Roll Cage Storage Tubes",
    slug: "roll-cage-storage-tubes",
    parent: "Roof Top",
    order: 23
  },
  {
    name: "Roller Shutter",
    slug: "roller-shutter",
    parent: "Roof Top",
    order: 24
  },
  {
    name: "roof box",
    slug: "roof-box",
    parent: "Roof Top",
    order: 25
  },
  {
    name: "roof carrier",
    slug: "roof-carrier-rooftop",
    parent: "Roof Top",
    order: 26
  },
  {
    name: "Roof Carrier",
    slug: "roof-carrier-alt",
    parent: "Roof Top",
    order: 27
  },
  {
    name: "roof light",
    slug: "roof-light-rooftop",
    parent: "Roof Top",
    order: 28
  },
  {
    name: "roof light bar",
    slug: "roof-light-bar",
    parent: "Roof Top",
    order: 29
  },
  {
    name: "roof rail rack",
    slug: "roof-rail-rack",
    parent: "Roof Top",
    order: 30
  },
  {
    name: "roof rails",
    slug: "roof-rails",
    parent: "Roof Top",
    order: 31
  },
  {
    name: "Roof Scoop",
    slug: "roof-scoop",
    parent: "Roof Top",
    order: 32
  },
  {
    name: "Roof Top Tent",
    slug: "roof-top-tent-rooftop",
    parent: "Roof Top",
    order: 33
  },
  {
    name: "Rugged Ridge",
    slug: "rugged-ridge",
    parent: "Roof Top",
    order: 34
  },
  {
    name: "Safari Snorkels",
    slug: "safari-snorkels",
    parent: "Roof Top",
    order: 35
  },
  {
    name: "seat cover",
    slug: "seat-cover-rooftop",
    parent: "Roof Top",
    order: 36
  },
  {
    name: "Shackle",
    slug: "shackle",
    parent: "Roof Top",
    order: 37
  },
  {
    name: "Shackle Hook",
    slug: "shackle-hook",
    parent: "Roof Top",
    order: 38
  },
  {
    name: "Shovel",
    slug: "shovel",
    parent: "Roof Top",
    order: 39
  },
  {
    name: "Side Step",
    slug: "side-step-rooftop",
    parent: "Roof Top",
    order: 40
  },
  {
    name: "Single Drawer System",
    slug: "single-drawer-system",
    parent: "Roof Top",
    order: 41
  },
  {
    name: "Skirting Kit",
    slug: "skirting-kit",
    parent: "Roof Top",
    order: 42
  },
  {
    name: "Snatch Rope",
    slug: "snatch-rope",
    parent: "Roof Top",
    order: 43
  },
  {
    name: "Snatch Strap",
    slug: "snatch-strap-rooftop",
    parent: "Roof Top",
    order: 44
  },
  {
    name: "Snorkel",
    slug: "snorkel",
    parent: "Roof Top",
    order: 45
  },
  {
    name: "Snow Chains",
    slug: "snow-chains",
    parent: "Roof Top",
    order: 46
  },
  {
    name: "SOF Cover",
    slug: "sof-cover",
    parent: "Roof Top",
    order: 47
  },
  {
    name: "Soft Cover",
    slug: "soft-cover-rooftop",
    parent: "Roof Top",
    order: 48
  },
  {
    name: "Spare Tire Relocation Kit",
    slug: "spare-tire-relocation-kit",
    parent: "Roof Top",
    order: 49
  },
  {
    name: "speaker",
    slug: "speaker",
    parent: "Roof Top",
    order: 50
  },
  {
    name: "strellar",
    slug: "strellar",
    parent: "Roof Top",
    order: 51
  },
  {
    name: "Storage Box",
    slug: "storage-box",
    parent: "Roof Top",
    order: 52
  },
  {
    name: "Stick On Roof Rails",
    slug: "stick-on-roof-rails",
    parent: "Roof Top",
    order: 53
  },
  {
    name: "Switch Panel",
    slug: "switch-panel-rooftop",
    parent: "Roof Top",
    order: 54
  },
  {
    name: "Tailgate Handle Cover",
    slug: "tailgate-handle-cover",
    parent: "Roof Top",
    order: 55
  },
  {
    name: "tailgate lid",
    slug: "tailgate-lid",
    parent: "Roof Top",
    order: 56
  },
  {
    name: "Tailgate Lock Kit",
    slug: "tailgate-lock-kit",
    parent: "Roof Top",
    order: 57
  },
  {
    name: "Tough Dog",
    slug: "tough-dog",
    parent: "Roof Top",
    order: 58
  },
  {
    name: "Toughdog",
    slug: "toughdog",
    parent: "Roof Top",
    order: 59
  },
  {
    name: "Towing Winch Soft Shackle",
    slug: "towing-winch-soft-shackle",
    parent: "Roof Top",
    order: 60
  },
  {
    name: "Trailer Arm",
    slug: "trailer-arm",
    parent: "Roof Top",
    order: 61
  },
  {
    name: "TRD skirting kit",
    slug: "trd-skirting-kit",
    parent: "Roof Top",
    order: 62
  },
  {
    name: "tree trunk protector",
    slug: "tree-trunk-protector",
    parent: "Roof Top",
    order: 63
  },
  {
    name: "Tri-Fold Cover",
    slug: "tri-fold-cover",
    parent: "Roof Top",
    order: 64
  },
  {
    name: "trunk storage bag",
    slug: "trunk-storage-bag",
    parent: "Roof Top",
    order: 65
  },
  {
    name: "Tyre Deflator",
    slug: "tyre-deflator",
    parent: "Roof Top",
    order: 66
  },
  {
    name: "Tyre Repair",
    slug: "tyre-repair",
    parent: "Roof Top",
    order: 67
  },
  {
    name: "Underbody Protection",
    slug: "underbody-protection",
    parent: "Roof Top",
    order: 68
  },
  {
    name: "Unicorn",
    slug: "unicorn",
    parent: "Roof Top",
    order: 69
  },
  {
    name: "Universal Mount",
    slug: "universal-mount",
    parent: "Roof Top",
    order: 70
  },
  {
    name: "urban sports",
    slug: "urban-sports",
    parent: "Roof Top",
    order: 71
  },
  {
    name: "Vehicles & Parts",
    slug: "vehicles-parts",
    parent: "Roof Top",
    order: 72
  },
  {
    name: "Vehicle Parts & Accessories",
    slug: "vehicle-parts-accessories",
    parent: "Roof Top",
    order: 73
  },
  {
    name: "dash instruments",
    slug: "dash-instruments",
    parent: "Roof Top",
    order: 74
  },
  {
    name: "Motor Vehicle Parts",
    slug: "motor-vehicle-parts",
    parent: "Roof Top",
    order: 75
  },
  {
    name: "Motor Vehicle Braking",
    slug: "motor-vehicle-braking",
    parent: "Roof Top",
    order: 76
  },
  {
    name: "Motor Vehicle Frame & Body Parts",
    slug: "motor-vehicle-frame-body-parts",
    parent: "Roof Top",
    order: 77
  },
  {
    name: "Spoilers",
    slug: "spoilers",
    parent: "Roof Top",
    order: 78
  },
  {
    name: "Motor Vehicle Lighting",
    slug: "motor-vehicle-lighting",
    parent: "Roof Top",
    order: 79
  },
  {
    name: "Motor Vehicle Suspension Parts",
    slug: "motor-vehicle-suspension-parts",
    parent: "Roof Top",
    order: 80
  },
  {
    name: "Vehicle Maintenance",
    slug: "vehicle-maintenance",
    parent: "Roof Top",
    order: 81
  },
  {
    name: "Vehicle Safety & Security",
    slug: "vehicle-safety-security",
    parent: "Roof Top",
    order: 82
  },
  {
    name: "Vehicle Alarms & Locks",
    slug: "vehicle-alarms-locks",
    parent: "Roof Top",
    order: 83
  },
  {
    name: "Automotive Alarm Accessories",
    slug: "automotive-alarm-accessories",
    parent: "Roof Top",
    order: 84
  },
  {
    name: "Vehicle Door Locks & Parts",
    slug: "vehicle-door-locks-parts",
    parent: "Roof Top",
    order: 85
  },
  {
    name: "Vehicle Safety Equipment",
    slug: "vehicle-safety-equipment",
    parent: "Roof Top",
    order: 86
  },
  {
    name: "Motor Vehicle Roll Cages & Bars",
    slug: "motor-vehicle-roll-cages-bars",
    parent: "Roof Top",
    order: 87
  },
  {
    name: "Vehicle Storage & Cargo",
    slug: "vehicle-storage-cargo",
    parent: "Roof Top",
    order: 88
  },
  {
    name: "Motor Vehicle Carrying Racks",
    slug: "motor-vehicle-carrying-racks",
    parent: "Roof Top",
    order: 89
  },
  {
    name: "Vehicle Cargo Racks",
    slug: "vehicle-cargo-racks",
    parent: "Roof Top",
    order: 90
  },
  {
    name: "wheel arch",
    slug: "wheel-arch",
    parent: "Roof Top",
    order: 91
  },
  {
    name: "Wheel Arch Cladding",
    slug: "wheel-arch-cladding",
    parent: "Roof Top",
    order: 92
  },
  {
    name: "Wheel Lock Nuts",
    slug: "wheel-lock-nuts",
    parent: "Roof Top",
    order: 93
  },
  {
    name: "Wheel Spacers",
    slug: "wheel-spacers",
    parent: "Roof Top",
    order: 94
  },
  {
    name: "Wind Screen Bar",
    slug: "wind-screen-bar",
    parent: "Roof Top",
    order: 95
  },
  {
    name: "wiring system",
    slug: "wiring-system",
    parent: "Roof Top",
    order: 96
  }
];

async function createCategories() {
  try {
    console.log('Creating main categories...');
    
    // Create main categories first
    const createdMainCategories = [];
    for (const cat of categoryStructure) {
      // Check if category already exists
      const existing = await Category.findOne({ slug: cat.slug });
      if (existing) {
        console.log(`Category ${cat.name} already exists`);
        createdMainCategories.push({ ...cat, _id: existing._id });
      } else {
        const newCategory = new Category(cat);
        const saved = await newCategory.save();
        console.log(`Created category: ${cat.name}`);
        createdMainCategories.push({ ...cat, _id: saved._id });
      }
    }
    
    console.log('Creating subcategories...');
    
    // Create subcategories
    let createdCount = 0;
    for (const subCat of subCategoryStructure) {
      // Find the parent category
      const parentCategory = createdMainCategories.find(cat => cat.name === subCat.parent);
      
      if (parentCategory) {
        // Check if subcategory already exists
        const existing = await Category.findOne({ slug: subCat.slug });
        if (existing) {
          console.log(`Subcategory ${subCat.name} already exists`);
        } else {
          const newSubCategory = new Category({
            ...subCat,
            parent: parentCategory._id
          });
          await newSubCategory.save();
          console.log(`Created subcategory: ${subCat.name} under ${subCat.parent}`);
          createdCount++;
        }
      } else {
        console.log(`Parent category ${subCat.parent} not found for ${subCat.name}`);
      }
    }
    
    console.log(`Category creation completed! Created ${createdCount} subcategories.`);
    
    // List all categories
    const allCategories = await Category.find({}).populate('parent', 'name');
    console.log('\nAll categories:');
    allCategories.forEach(cat => {
      console.log(`${cat.name} (${cat.slug}) ${cat.parent ? `-> ${cat.parent.name}` : ''}`);
    });
    
    mongoose.connection.close();
  } catch (error) {
    console.error('Error creating categories:', error);
    mongoose.connection.close();
  }
}

// Run the category creation
createCategories();