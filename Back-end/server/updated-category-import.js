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
  },
  // New categories from your list
  {
    name: "Air Suspension",
    slug: "air-suspension",
    description: "Air suspension systems and components",
    order: 14
  },
  {
    name: "Android car stereo",
    slug: "android-car-stereo",
    description: "Android-based car entertainment systems",
    order: 15
  },
  {
    name: "Armrest Console",
    slug: "armrest-console",
    description: "Armrests and center consoles for vehicles",
    order: 16
  },
  {
    name: "Automotive Storage",
    slug: "automotive-storage",
    description: "Storage solutions for vehicles",
    order: 17
  },
  {
    name: "Awning",
    slug: "awning",
    description: "Vehicle awnings and camping equipment",
    order: 18
  },
  {
    name: "Brake Kit",
    slug: "brake-kit",
    description: "Complete brake system kits",
    order: 19
  },
  {
    name: "Brands",
    slug: "brands",
    description: "Product brands and manufacturers",
    order: 20
  },
  {
    name: "Cabkle Kit",
    slug: "cabkle-kit",
    description: "Cable management kits",
    order: 21
  },
  {
    name: "CPL Filter",
    slug: "cpl-filter",
    description: "Circular polarizing lens filters",
    order: 22
  },
  {
    name: "Dashcam Accessories",
    slug: "dashcam-accessories",
    description: "Accessories for dash cameras",
    order: 23
  },
  {
    name: "STRONTIUM",
    slug: "strontium",
    description: "Strontium brand products",
    order: 24
  },
  {
    name: "JUMP STARTER",
    slug: "jump-starter",
    description: "Jump starter devices and equipment",
    order: 25
  }
];

// Define subcategories with parent relationships
const subCategoryStructure = [
  // Accessories subcategories
  {
    name: "Back cover full aluminium box",
    slug: "back-cover-full-aluminium-box",
    parent: "Accessories",
    order: 1
  },
  {
    name: "Balance Arms",
    slug: "balance-arms",
    parent: "Accessories",
    order: 2
  },
  {
    name: "Bash Plate",
    slug: "bash-plate",
    parent: "Accessories",
    order: 3
  },
  {
    name: "Bed Liner",
    slug: "bed-liner",
    parent: "Accessories",
    order: 4
  },
  {
    name: "Bed Rack",
    slug: "bed-rack",
    parent: "Accessories",
    order: 5
  },
  {
    name: "Body kit car bumber",
    slug: "body-kit-car-bumber",
    parent: "Accessories",
    order: 6
  },
  {
    name: "Body Protection Plate Patch",
    slug: "body-protection-plate-patch",
    parent: "Accessories",
    order: 7
  },
  {
    name: "bonnet",
    slug: "bonnet",
    parent: "Accessories",
    order: 8
  },
  {
    name: "Bonnet Air Vent",
    slug: "bonnet-air-vent",
    parent: "Accessories",
    order: 9
  },
  {
    name: "bonnet Engine Hood Cover",
    slug: "bonnet-engine-hood-cover",
    parent: "Accessories",
    order: 10
  },
  {
    name: "bonnet hood",
    slug: "bonnet-hood",
    parent: "Accessories",
    order: 11
  },
  {
    name: "bonnet hood air vent",
    slug: "bonnet-hood-air-vent",
    parent: "Accessories",
    order: 12
  },
  {
    name: "bonnet hood visor",
    slug: "bonnet-hood-visor",
    parent: "Accessories",
    order: 13
  },
  {
    name: "Bonnet Scoop",
    slug: "bonnet-scoop",
    parent: "Accessories",
    order: 14
  },
  {
    name: "brake pads",
    slug: "brake-pads",
    parent: "Accessories",
    order: 15
  },
  {
    name: "brake rotors",
    slug: "brake-rotors",
    parent: "Accessories",
    order: 16
  },
  {
    name: "Brake Light",
    slug: "brake-light",
    parent: "Accessories",
    order: 17
  },
  {
    name: "70MAI",
    slug: "70mai",
    parent: "Accessories",
    order: 18
  },
  {
    name: "Aeroklas",
    slug: "aeroklas",
    parent: "Accessories",
    order: 19
  },
  {
    name: "AES",
    slug: "aes",
    parent: "Accessories",
    order: 20
  },
  {
    name: "AFN",
    slug: "afn",
    parent: "Accessories",
    order: 21
  },
  {
    name: "Airllen",
    slug: "airllen",
    parent: "Accessories",
    order: 22
  },
  {
    name: "AMG",
    slug: "amg",
    parent: "Accessories",
    order: 23
  },
  {
    name: "AOZOOM",
    slug: "aozoom",
    parent: "Accessories",
    order: 24
  },
  {
    name: "armado",
    slug: "armado",
    parent: "Accessories",
    order: 25
  },
  {
    name: "ARMORO",
    slug: "armoro",
    parent: "Accessories",
    order: 26
  },
  {
    name: "ATOTO",
    slug: "atoto",
    parent: "Accessories",
    order: 27
  },
  {
    name: "Autobacs India",
    slug: "autobacs-india",
    parent: "Accessories",
    order: 28
  },
  {
    name: "auxbeam",
    slug: "auxbeam",
    parent: "Accessories",
    order: 29
  },
  {
    name: "Barado",
    slug: "barado",
    parent: "Accessories",
    order: 30
  },
  {
    name: "Baseus",
    slug: "baseus",
    parent: "Accessories",
    order: 31
  },
  {
    name: "BAT",
    slug: "bat",
    parent: "Accessories",
    order: 32
  },
  {
    name: "Bazard",
    slug: "bazard",
    parent: "Accessories",
    order: 33
  },
  {
    name: "Bigxx",
    slug: "bigxx",
    parent: "Accessories",
    order: 34
  },
  {
    name: "BITA",
    slug: "bita",
    parent: "Accessories",
    order: 35
  },
  {
    name: "BMC",
    slug: "bmc",
    parent: "Accessories",
    order: 36
  },
  {
    name: "Borla",
    slug: "borla",
    parent: "Accessories",
    order: 37
  },
  {
    name: "BRD",
    slug: "brd",
    parent: "Accessories",
    order: 38
  },
  {
    name: "Brembo",
    slug: "brembo",
    parent: "Accessories",
    order: 39
  },
  {
    name: "Bullhorn",
    slug: "bullhorn",
    parent: "Accessories",
    order: 40
  },
  {
    name: "Bushranger",
    slug: "bushranger",
    parent: "Accessories",
    order: 41
  },
  {
    name: "ComeUp",
    slug: "comeup",
    parent: "Accessories",
    order: 42
  },
  {
    name: "Crystal EYE",
    slug: "crystal-eye",
    parent: "Accessories",
    order: 43
  },
  {
    name: "Dobinsons",
    slug: "dobinsons",
    parent: "Accessories",
    order: 44
  },
  {
    name: "Dr. Nano",
    slug: "dr-nano",
    parent: "Accessories",
    order: 45
  },
  {
    name: "GECKO",
    slug: "gecko",
    parent: "Accessories",
    order: 46
  },
  {
    name: "GR",
    slug: "gr",
    parent: "Accessories",
    order: 47
  },
  {
    name: "Hamer",
    slug: "hamer",
    parent: "Accessories",
    order: 48
  },
  {
    name: "Helix",
    slug: "helix",
    parent: "Accessories",
    order: 49
  },
  {
    name: "HELLA",
    slug: "hella",
    parent: "Accessories",
    order: 50
  },
  {
    name: "Ironman 4x4",
    slug: "ironman-4x4",
    parent: "Accessories",
    order: 51
  },
  {
    name: "JCBL",
    slug: "jcbl",
    parent: "Accessories",
    order: 52
  },
  {
    name: "JK",
    slug: "jk",
    parent: "Accessories",
    order: 53
  },
  {
    name: "Jmax",
    slug: "jmax",
    parent: "Accessories",
    order: 54
  },
  {
    name: "Kahn Design",
    slug: "kahn-design",
    parent: "Accessories",
    order: 55
  },
  {
    name: "Legender",
    slug: "legender",
    parent: "Accessories",
    order: 56
  },
  {
    name: "Lightforce",
    slug: "lightforce",
    parent: "Accessories",
    order: 57
  },
  {
    name: "Lumma",
    slug: "lumma",
    parent: "Accessories",
    order: 58
  },
  {
    name: "M.A.R.K. Sport",
    slug: "mark-sport",
    parent: "Accessories",
    order: 59
  },
  {
    name: "MARK Sports",
    slug: "mark-sports",
    parent: "Accessories",
    order: 60
  },
  {
    name: "Niaoguichao",
    slug: "niaoguichao",
    parent: "Accessories",
    order: 61
  },
  {
    name: "Option4WD",
    slug: "option4wd",
    parent: "Accessories",
    order: 62
  },
  {
    name: "Rear bar",
    slug: "rear-bar",
    parent: "Accessories",
    order: 63
  },
  {
    name: "sports bar",
    slug: "sports-bar",
    parent: "Accessories",
    order: 64
  },
  {
    name: "OUTLANDER",
    slug: "outlander",
    parent: "Accessories",
    order: 65
  },
  {
    name: "Overland",
    slug: "overland",
    parent: "Accessories",
    order: 66
  },
  {
    name: "Pharaoh",
    slug: "pharaoh",
    parent: "Accessories",
    order: 67
  },
  {
    name: "prad",
    slug: "prad",
    parent: "Accessories",
    order: 68
  },
  {
    name: "Profender",
    slug: "profender",
    parent: "Accessories",
    order: 69
  },
  {
    name: "Proman",
    slug: "proman",
    parent: "Accessories",
    order: 70
  },
  {
    name: "RAD",
    slug: "rad",
    parent: "Accessories",
    order: 71
  },
  {
    name: "Remus",
    slug: "remus",
    parent: "Accessories",
    order: 72
  },
  {
    name: "Revolution",
    slug: "revolution",
    parent: "Accessories",
    order: 73
  },
  {
    name: "Rhino Pro",
    slug: "rhino-pro",
    parent: "Accessories",
    order: 74
  },
  {
    name: "Sammitr",
    slug: "sammitr",
    parent: "Accessories",
    order: 75
  },
  {
    name: "STEDI",
    slug: "stedi",
    parent: "Accessories",
    order: 76
  },
  {
    name: "Thor",
    slug: "thor",
    parent: "Accessories",
    order: 77
  },
  {
    name: "Tithum",
    slug: "tithum",
    parent: "Accessories",
    order: 78
  },
  {
    name: "TJM",
    slug: "tjm",
    parent: "Accessories",
    order: 79
  },
  {
    name: "Tough Dog",
    slug: "tough-dog",
    parent: "Accessories",
    order: 80
  },
  {
    name: "UFO",
    slug: "ufo",
    parent: "Accessories",
    order: 81
  },
  {
    name: "Versnellen",
    slug: "versnellen",
    parent: "Accessories",
    order: 82
  },
  {
    name: "Vland",
    slug: "vland",
    parent: "Accessories",
    order: 83
  },
  {
    name: "Volmax",
    slug: "volmax",
    parent: "Accessories",
    order: 84
  },
  {
    name: "warn",
    slug: "warn",
    parent: "Accessories",
    order: 85
  },
  {
    name: "windbooster GT",
    slug: "windbooster-gt",
    parent: "Accessories",
    order: 86
  },
  {
    name: "Bullbar",
    slug: "bullbar",
    parent: "Accessories",
    order: 87
  },
  {
    name: "bumper bar",
    slug: "bumper-bar",
    parent: "Accessories",
    order: 88
  },
  {
    name: "Canopy",
    slug: "canopy",
    parent: "Accessories",
    order: 89
  },
  {
    name: "Carbon Fiber Rear Wing Spoiler",
    slug: "carbon-fiber-rear-wing-spoiler",
    parent: "Accessories",
    order: 90
  },
  {
    name: "Care & Decor",
    slug: "care-decor",
    parent: "Accessories",
    order: 91
  },
  {
    name: "Vehicle Covers",
    slug: "vehicle-covers",
    parent: "Accessories",
    order: 92
  },
  {
    name: "Tonneau Covers",
    slug: "tonneau-covers",
    parent: "Accessories",
    order: 93
  },
  {
    name: "Vehicle Decor",
    slug: "vehicle-decor",
    parent: "Accessories",
    order: 94
  },
  {
    name: "Vehicle Air Fresheners",
    slug: "vehicle-air-fresheners",
    parent: "Accessories",
    order: 95
  },
  {
    name: "Vehicle Paint",
    slug: "vehicle-paint",
    parent: "Accessories",
    order: 96
  },
  {
    name: "Center Console",
    slug: "center-console",
    parent: "Accessories",
    order: 97
  },
  {
    name: "Center spoiler garnish",
    slug: "center-spoiler-garnish",
    parent: "Accessories",
    order: 98
  },
  {
    name: "Climate Control",
    slug: "climate-control",
    parent: "Accessories",
    order: 99
  },
  {
    name: "COASTA",
    slug: "coasta",
    parent: "Accessories",
    order: 100
  },
  {
    name: "coil springs",
    slug: "coil-springs",
    parent: "Accessories",
    order: 101
  },
  {
    name: "Coil Suspension",
    slug: "coil-suspension",
    parent: "Accessories",
    order: 102
  },
  {
    name: "Compressors",
    slug: "compressors",
    parent: "Accessories",
    order: 103
  },
  {
    name: "Connecting Center Light",
    slug: "connecting-center-light",
    parent: "Accessories",
    order: 104
  },
  {
    name: "Conversion Kit",
    slug: "conversion-kit",
    parent: "Accessories",
    order: 105
  },
  {
    name: "conversion trims",
    slug: "conversion-trims",
    parent: "Accessories",
    order: 106
  },
  {
    name: "Convertible Soft Top",
    slug: "convertible-soft-top",
    parent: "Accessories",
    order: 107
  },
  {
    name: "cross bar",
    slug: "cross-bar",
    parent: "Accessories",
    order: 108
  },
  {
    name: "Crystal",
    slug: "crystal",
    parent: "Accessories",
    order: 109
  },
  {
    name: "Crystal gear knob",
    slug: "crystal-gear-knob",
    parent: "Accessories",
    order: 110
  },
  {
    name: "Dicky Garnish",
    slug: "dicky-garnish",
    parent: "Accessories",
    order: 111
  },
  {
    name: "Differential Drop Kit",
    slug: "differential-drop-kit",
    parent: "Accessories",
    order: 112
  },
  {
    name: "diffuser",
    slug: "diffuser",
    parent: "Accessories",
    order: 113
  },
  {
    name: "Digital Climate Control Panel",
    slug: "digital-climate-control-panel-sub",
    parent: "Accessories",
    order: 114
  },
  {
    name: "Digital Cluster",
    slug: "digital-cluster",
    parent: "Accessories",
    order: 115
  },
  {
    name: "Door Hinge",
    slug: "door-hinge",
    parent: "Accessories",
    order: 116
  },
  {
    name: "Door Switch Panel",
    slug: "door-switch-panel",
    parent: "Accessories",
    order: 117
  },
  {
    name: "Door Visor",
    slug: "door-visor",
    parent: "Accessories",
    order: 118
  },
  {
    name: "driving light protective covers",
    slug: "driving-light-protective-covers",
    parent: "Accessories",
    order: 119
  },
  {
    name: "Electronic Exhaust System",
    slug: "electronic-exhaust-system",
    parent: "Accessories",
    order: 120
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
    slug: "bonnet-exterior",
    parent: "Exterior",
    order: 5
  },
  {
    name: "Bonnet Hood",
    slug: "bonnet-hood-exterior",
    parent: "Exterior",
    order: 6
  },
  {
    name: "Bumper",
    slug: "bumper-exterior",
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
    slug: "diffusers-exterior",
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
    slug: "front-lip-exterior",
    parent: "Exterior",
    order: 11
  },
  {
    name: "Grill",
    slug: "grill-exterior",
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
    slug: "mirrors-exterior",
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
    slug: "roll-bar-exterior",
    parent: "Exterior",
    order: 16
  },
  {
    name: "Side Steps",
    slug: "side-steps-exterior",
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
    slug: "spoiler-exterior",
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
    slug: "roof-carrier-exterior",
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
    slug: "face-lift-exterior",
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
    slug: "fender-flare-exterior",
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
    slug: "floor-mat-exterior",
    parent: "Exterior",
    order: 38
  },
  {
    name: "Foam Cell Shock Absorbers",
    slug: "foam-cell-shock-absorbers-exterior",
    parent: "Exterior",
    order: 39
  },
  {
    name: "Foot Step",
    slug: "foot-step-exterior",
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
    slug: "front-grill-exterior",
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
    slug: "front-splitter-exterior",
    parent: "Exterior",
    order: 46
  },
  {
    name: "Gear Knob",
    slug: "gear-knob-exterior",
    parent: "Exterior",
    order: 47
  },
  {
    name: "Gear Knob Cover",
    slug: "gear-knob-cover-exterior",
    parent: "Exterior",
    order: 48
  },
  {
    name: "GECKO RACING",
    slug: "gecko-racing-exterior",
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
    slug: "grab-handle-exterior",
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
    slug: "hud-exterior",
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
    slug: "icecube-drawer-fridge-exterior",
    parent: "Exterior",
    order: 55
  },
  {
    name: "Infotainment System",
    slug: "infotainment-system-exterior",
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
    slug: "leveling-kit-interior",
    parent: "Interior",
    order: 15
  },
  {
    name: "lift kit",
    slug: "lift-kit-interior",
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
    slug: "bulb-lighting",
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
    slug: "drl-lighting",
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
    slug: "projector-headlights-lighting",
    parent: "Lighting",
    order: 19
  },
  {
    name: "Indicator",
    slug: "indicator-lighting",
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
    slug: "roof-light-lighting",
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
    slug: "coilovers-performance",
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
    slug: "exhaust-performance",
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
    name: "Suspension",
    slug: "suspension-performance",
    parent: "Performance",
    order: 7
  },
  {
    name: "switch panel system",
    slug: "switch-panel-system",
    parent: "Performance",
    order: 8
  },
  {
    name: "throttle controllers",
    slug: "throttle-controllers",
    parent: "Performance",
    order: 9
  },
  {
    name: "Turbo",
    slug: "turbo",
    parent: "Performance",
    order: 10
  },

  // Suspension subcategories
  {
    name: "Foam Cell Shock Absorbers",
    slug: "foam-cell-shock-absorbers-suspension",
    parent: "Suspension",
    order: 1
  },
  {
    name: "Load Helper Spring Kit",
    slug: "load-helper-spring-kit",
    parent: "Suspension",
    order: 2
  },
  {
    name: "Lowering Coil Springs",
    slug: "lowering-coil-springs",
    parent: "Suspension",
    order: 3
  },
  {
    name: "Nitro Gas Shock Absorbers",
    slug: "nitro-gas-shock-absorbers",
    parent: "Suspension",
    order: 4
  },
  {
    name: "Nitro Gas Suspension",
    slug: "nitro-gas-suspension",
    parent: "Suspension",
    order: 5
  },
  {
    name: "Shock Absorbers",
    slug: "shock-absorbers-suspension",
    parent: "Suspension",
    order: 6
  },
  {
    name: "suspension",
    slug: "suspension-sub",
    parent: "Suspension",
    order: 7
  },
  {
    name: "Suspension Kit",
    slug: "suspension-kit",
    parent: "Suspension",
    order: 8
  },
  {
    name: "Suspension Lift Kit",
    slug: "suspension-lift-kit",
    parent: "Suspension",
    order: 9
  },
  {
    name: "Upper Control Arms",
    slug: "upper-control-arms",
    parent: "Suspension",
    order: 10
  },

  // Body Kits subcategories
  {
    name: "Lip Kit",
    slug: "lip-kit",
    parent: "Body Kits",
    order: 1
  },
  {
    name: "Splitter",
    slug: "splitter",
    parent: "Body Kits",
    order: 2
  },
  {
    name: "spoiler",
    slug: "spoiler-body-kits",
    parent: "Body Kits",
    order: 3
  },
  {
    name: "Spoiler Lip",
    slug: "spoiler-lip",
    parent: "Body Kits",
    order: 4
  },
  {
    name: "Sports Bar",
    slug: "sports-bar-body-kits",
    parent: "Body Kits",
    order: 5
  },
  {
    name: "tailgate spoiler",
    slug: "tailgate-spoiler",
    parent: "Body Kits",
    order: 6
  },

  // Protection Kit subcategories
  {
    name: "Loop bar",
    slug: "loop-bar",
    parent: "Protection Kit",
    order: 1
  },
  {
    name: "Lunar Carrier",
    slug: "lunar-carrier",
    parent: "Protection Kit",
    order: 2
  },
  {
    name: "metal canopy",
    slug: "metal-canopy",
    parent: "Protection Kit",
    order: 3
  },
  {
    name: "metal pedal kit",
    slug: "metal-pedal-kit",
    parent: "Protection Kit",
    order: 4
  },
  {
    name: "Meter Console",
    slug: "meter-console",
    parent: "Protection Kit",
    order: 5
  },
  {
    name: "Mirror Cover",
    slug: "mirror-cover",
    parent: "Protection Kit",
    order: 6
  },
  {
    name: "Mirros",
    slug: "mirros",
    parent: "Protection Kit",
    order: 7
  },
  {
    name: "modular roof carrier",
    slug: "modular-roof-carrier",
    parent: "Protection Kit",
    order: 8
  },
  {
    name: "mud flap",
    slug: "mud-flap",
    parent: "Protection Kit",
    order: 9
  },
  {
    name: "Mud Tracks",
    slug: "mud-tracks",
    parent: "Protection Kit",
    order: 10
  },
  {
    name: "Neck Rest",
    slug: "neck-rest",
    parent: "Protection Kit",
    order: 11
  },
  {
    name: "Nitro Gas Shock Absorbers",
    slug: "nitro-gas-shock-absorbers-protection",
    parent: "Protection Kit",
    order: 12
  },
  {
    name: "Off Road Accessories",
    slug: "off-road-accessories",
    parent: "Protection Kit",
    order: 13
  },
  {
    name: "Overhead Storage Mesh",
    slug: "overhead-storage-mesh",
    parent: "Protection Kit",
    order: 14
  },
  {
    name: "Overhead Storage Net",
    slug: "overhead-storage-net",
    parent: "Protection Kit",
    order: 15
  },
  {
    name: "Power Bank",
    slug: "power-bank",
    parent: "Protection Kit",
    order: 16
  },
  {
    name: "projector headlights",
    slug: "projector-headlights-protection",
    parent: "Protection Kit",
    order: 17
  },
  {
    name: "quick step",
    slug: "quick-step",
    parent: "Protection Kit",
    order: 18
  },
  {
    name: "Rear Balance Arms",
    slug: "rear-balance-arms",
    parent: "Protection Kit",
    order: 19
  },
  {
    name: "Recovery Point",
    slug: "recovery-point",
    parent: "Protection Kit",
    order: 20
  },
  {
    name: "Recovery Rope",
    slug: "recovery-rope",
    parent: "Protection Kit",
    order: 21
  },
  {
    name: "recovory damper",
    slug: "recovory-damper",
    parent: "Protection Kit",
    order: 22
  },
  {
    name: "Refrigerator",
    slug: "refrigerator",
    parent: "Protection Kit",
    order: 23
  },
  {
    name: "Revival Kit",
    slug: "revival-kit",
    parent: "Protection Kit",
    order: 24
  },
  {
    name: "Rock Slider",
    slug: "rock-slider",
    parent: "Protection Kit",
    order: 25
  },
  {
    name: "Roll Bar Cage Storage Bag",
    slug: "roll-bar-cage-storage-bag",
    parent: "Protection Kit",
    order: 26
  },
  {
    name: "Roll Cage Storage Tubes",
    slug: "roll-cage-storage-tubes",
    parent: "Protection Kit",
    order: 27
  },
  {
    name: "Roller Shutter",
    slug: "roller-shutter",
    parent: "Protection Kit",
    order: 28
  },
  {
    name: "roof box",
    slug: "roof-box",
    parent: "Protection Kit",
    order: 29
  },
  {
    name: "roof carrier",
    slug: "roof-carrier-protection",
    parent: "Protection Kit",
    order: 30
  },
  {
    name: "Roof Carrier",
    slug: "roof-carrier-alt",
    parent: "Protection Kit",
    order: 31
  },
  {
    name: "roof light",
    slug: "roof-light",
    parent: "Protection Kit",
    order: 32
  },
  {
    name: "roof light bar",
    slug: "roof-light-bar",
    parent: "Protection Kit",
    order: 33
  },
  {
    name: "roof rail rack",
    slug: "roof-rail-rack",
    parent: "Protection Kit",
    order: 34
  },
  {
    name: "roof rails",
    slug: "roof-rails",
    parent: "Protection Kit",
    order: 35
  },
  {
    name: "Roof Scoop",
    slug: "roof-scoop",
    parent: "Protection Kit",
    order: 36
  },
  {
    name: "Roof Top Tent",
    slug: "roof-top-tent",
    parent: "Protection Kit",
    order: 37
  },
  {
    name: "Rugged Ridge",
    slug: "rugged-ridge",
    parent: "Protection Kit",
    order: 38
  },
  {
    name: "Safari Snorkels",
    slug: "safari-snorkels",
    parent: "Protection Kit",
    order: 39
  },
  {
    name: "seat cover",
    slug: "seat-cover-protection",
    parent: "Protection Kit",
    order: 40
  },
  {
    name: "Shackle",
    slug: "shackle",
    parent: "Protection Kit",
    order: 41
  },
  {
    name: "Shackle Hook",
    slug: "shackle-hook",
    parent: "Protection Kit",
    order: 42
  },
  {
    name: "Shock Absorbers",
    slug: "shock-absorbers-protection",
    parent: "Protection Kit",
    order: 43
  },
  {
    name: "Shovel",
    slug: "shovel",
    parent: "Protection Kit",
    order: 44
  },
  {
    name: "Side Step",
    slug: "side-step",
    parent: "Protection Kit",
    order: 45
  },
  {
    name: "Single Drawer System",
    slug: "single-drawer-system",
    parent: "Protection Kit",
    order: 46
  },
  {
    name: "Skirting Kit",
    slug: "skirting-kit",
    parent: "Protection Kit",
    order: 47
  },
  {
    name: "Snatch Rope",
    slug: "snatch-rope",
    parent: "Protection Kit",
    order: 48
  },
  {
    name: "Snatch Strap",
    slug: "snatch-strap",
    parent: "Protection Kit",
    order: 49
  },
  {
    name: "Snorkel",
    slug: "snorkel",
    parent: "Protection Kit",
    order: 50
  },
  {
    name: "Snow Chains",
    slug: "snow-chains",
    parent: "Protection Kit",
    order: 51
  },
  {
    name: "SOF Cover",
    slug: "sof-cover",
    parent: "Protection Kit",
    order: 52
  },
  {
    name: "Soft Cover",
    slug: "soft-cover",
    parent: "Protection Kit",
    order: 53
  },
  {
    name: "Spare Tire Relocation Kit",
    slug: "spare-tire-relocation-kit",
    parent: "Protection Kit",
    order: 54
  },
  {
    name: "speaker",
    slug: "speaker",
    parent: "Protection Kit",
    order: 55
  },
  {
    name: "strellar",
    slug: "strellar",
    parent: "Protection Kit",
    order: 56
  },
  {
    name: "Storage Box",
    slug: "storage-box",
    parent: "Protection Kit",
    order: 57
  },
  {
    name: "Streering Damper",
    slug: "streering-damper",
    parent: "Protection Kit",
    order: 58
  },
  {
    name: "Streering Trims",
    slug: "streering-trims",
    parent: "Protection Kit",
    order: 59
  },
  {
    name: "streering wheel",
    slug: "streering-wheel",
    parent: "Protection Kit",
    order: 60
  },
  {
    name: "stepney cover",
    slug: "stepney-cover",
    parent: "Protection Kit",
    order: 61
  },
  {
    name: "Stick On Roof Rails",
    slug: "stick-on-roof-rails",
    parent: "Protection Kit",
    order: 62
  },
  {
    name: "Switch Panel",
    slug: "switch-panel",
    parent: "Protection Kit",
    order: 63
  },
  {
    name: "Tailgate Handle Cover",
    slug: "tailgate-handle-cover",
    parent: "Protection Kit",
    order: 64
  },
  {
    name: "tailgate lid",
    slug: "tailgate-lid",
    parent: "Protection Kit",
    order: 65
  },
  {
    name: "Tailgate Lock Kit",
    slug: "tailgate-lock-kit",
    parent: "Protection Kit",
    order: 66
  },
  {
    name: "Tough Dog",
    slug: "tough-dog-protection",
    parent: "Protection Kit",
    order: 67
  },
  {
    name: "Toughdog",
    slug: "toughdog",
    parent: "Protection Kit",
    order: 68
  },
  {
    name: "Towing Winch Soft Shackle",
    slug: "towing-winch-soft-shackle",
    parent: "Protection Kit",
    order: 69
  },
  {
    name: "Trailer Arm",
    slug: "trailer-arm",
    parent: "Protection Kit",
    order: 70
  },
  {
    name: "TRD skirting kit",
    slug: "trd-skirting-kit",
    parent: "Protection Kit",
    order: 71
  },
  {
    name: "tree trunk protector",
    slug: "tree-trunk-protector",
    parent: "Protection Kit",
    order: 72
  },
  {
    name: "Tri-Fold Cover",
    slug: "tri-fold-cover",
    parent: "Protection Kit",
    order: 73
  },
  {
    name: "trunk storage bag",
    slug: "trunk-storage-bag",
    parent: "Protection Kit",
    order: 74
  },
  {
    name: "Tyre Deflator",
    slug: "tyre-deflator",
    parent: "Protection Kit",
    order: 75
  },
  {
    name: "Tyre Repair",
    slug: "tyre-repair",
    parent: "Protection Kit",
    order: 76
  },
  {
    name: "Underbody Protection",
    slug: "underbody-protection",
    parent: "Protection Kit",
    order: 77
  },
  {
    name: "Unicorn",
    slug: "unicorn",
    parent: "Protection Kit",
    order: 78
  },
  {
    name: "Universal Mount",
    slug: "universal-mount",
    parent: "Protection Kit",
    order: 79
  },
  {
    name: "urban sports",
    slug: "urban-sports",
    parent: "Protection Kit",
    order: 80
  },
  {
    name: "Vehicles & Parts",
    slug: "vehicles-parts",
    parent: "Protection Kit",
    order: 81
  },
  {
    name: "Vehicle Parts & Accessories",
    slug: "vehicle-parts-accessories",
    parent: "Protection Kit",
    order: 82
  },
  {
    name: "dash instruments",
    slug: "dash-instruments",
    parent: "Protection Kit",
    order: 83
  },
  {
    name: "Motor Vehicle Parts",
    slug: "motor-vehicle-parts",
    parent: "Protection Kit",
    order: 84
  },
  {
    name: "Motor Vehicle Braking",
    slug: "motor-vehicle-braking",
    parent: "Protection Kit",
    order: 85
  },
  {
    name: "Motor Vehicle Frame & Body Parts",
    slug: "motor-vehicle-frame-body-parts",
    parent: "Protection Kit",
    order: 86
  },
  {
    name: "Spoilers",
    slug: "spoilers",
    parent: "Protection Kit",
    order: 87
  },
  {
    name: "Motor Vehicle Lighting",
    slug: "motor-vehicle-lighting",
    parent: "Protection Kit",
    order: 88
  },
  {
    name: "Motor Vehicle Suspension Parts",
    slug: "motor-vehicle-suspension-parts",
    parent: "Protection Kit",
    order: 89
  },
  {
    name: "Vehicle Maintenance",
    slug: "vehicle-maintenance",
    parent: "Protection Kit",
    order: 90
  },
  {
    name: "Vehicle Safety & Security",
    slug: "vehicle-safety-security",
    parent: "Protection Kit",
    order: 91
  },
  {
    name: "Vehicle Alarms & Locks",
    slug: "vehicle-alarms-locks",
    parent: "Protection Kit",
    order: 92
  },
  {
    name: "Automotive Alarm Accessories",
    slug: "automotive-alarm-accessories",
    parent: "Protection Kit",
    order: 93
  },
  {
    name: "Vehicle Door Locks & Parts",
    slug: "vehicle-door-locks-parts",
    parent: "Protection Kit",
    order: 94
  },
  {
    name: "Vehicle Safety Equipment",
    slug: "vehicle-safety-equipment",
    parent: "Protection Kit",
    order: 95
  },
  {
    name: "Motor Vehicle Roll Cages & Bars",
    slug: "motor-vehicle-roll-cages-bars",
    parent: "Protection Kit",
    order: 96
  },
  {
    name: "Vehicle Storage & Cargo",
    slug: "vehicle-storage-cargo",
    parent: "Protection Kit",
    order: 97
  },
  {
    name: "Motor Vehicle Carrying Racks",
    slug: "motor-vehicle-carrying-racks",
    parent: "Protection Kit",
    order: 98
  },
  {
    name: "Vehicle Cargo Racks",
    slug: "vehicle-cargo-racks",
    parent: "Protection Kit",
    order: 99
  },
  {
    name: "wheel arch",
    slug: "wheel-arch",
    parent: "Protection Kit",
    order: 100
  },
  {
    name: "Wheel Arch Cladding",
    slug: "wheel-arch-cladding",
    parent: "Protection Kit",
    order: 101
  },
  {
    name: "Wheel Lock Nuts",
    slug: "wheel-lock-nuts",
    parent: "Protection Kit",
    order: 102
  },
  {
    name: "Wheel Spacers",
    slug: "wheel-spacers",
    parent: "Protection Kit",
    order: 103
  },
  {
    name: "Winch",
    slug: "winch-protection",
    parent: "Protection Kit",
    order: 104
  },
  {
    name: "winch extension strap",
    slug: "winch-extension-strap",
    parent: "Protection Kit",
    order: 105
  },
  {
    name: "Winch Hook",
    slug: "winch-hook",
    parent: "Protection Kit",
    order: 106
  },
  {
    name: "Wind Screen Bar",
    slug: "wind-screen-bar",
    parent: "Protection Kit",
    order: 107
  },
  {
    name: "wiring system",
    slug: "wiring-system",
    parent: "Protection Kit",
    order: 108
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