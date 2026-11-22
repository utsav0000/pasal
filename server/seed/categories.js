// [slug, name, icon, children[]] — icon names map to Phosphor duotone icons in the UI.
// Attribute tuple: [key, label, type, options|null, unit|null, required, filterable]
const storage = ['32 GB', '64 GB', '128 GB', '256 GB', '512 GB', '1 TB'];
const ram = ['2 GB', '3 GB', '4 GB', '6 GB', '8 GB', '12 GB', '16 GB', '32 GB', '64 GB'];
const year = ['year', 'Year', 'number', null, null, true, true];
const km = ['km_driven', 'Kilometres driven', 'number', null, 'km', true, false];
const fuel = ['fuel', 'Fuel', 'select', ['Petrol', 'Diesel', 'CNG', 'Electric', 'Hybrid', 'LPG'], null, true, true];
const owners = ['owners', 'Owners', 'select', ['1st owner', '2nd owner', '3rd owner', '4th owner or more'], null, false, true];
const furnishing = ['furnishing', 'Furnishing', 'select', ['Unfurnished', 'Semi-furnished', 'Fully furnished'], null, false, true];
const listingType = ['listing_type', 'For', 'select', ['Rent', 'Sale'], null, true, true];
const bedrooms = ['bedrooms', 'Bedrooms', 'select', ['1 RK', '1 BHK', '2 BHK', '3 BHK', '4 BHK', '5+ BHK'], null, true, true];
const area = ['area_sqft', 'Built-up area', 'number', null, 'sq ft', true, false];
const clothSize = ['size', 'Size', 'select', ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'Free size'], null, false, true];
const color = ['color', 'Colour', 'text', null, null, false, false];
const exp = ['experience', 'Experience', 'number', null, 'years', false, false];
const area2 = ['service_area', 'Service area', 'text', null, null, false, false];

export const CATEGORIES = [
  ['electronics', 'Electronics', 'Lightning', '#6A4DFF', 'Phones, laptops, cameras and everything that plugs in.', [
    ['smartphones', 'Smartphones', 'DeviceMobile', [['storage', 'Storage', 'select', storage, null, true, true], ['ram', 'RAM', 'select', ram, null, false, true], color, ['battery_health', 'Battery health', 'number', null, '%', false, false]]],
    ['laptops', 'Laptops', 'Laptop', [['processor', 'Processor', 'text', null, null, true, false], ['ram', 'RAM', 'select', ram, null, true, true], ['storage', 'Storage', 'select', storage, null, true, true], ['screen_size', 'Screen size', 'number', null, 'inch', false, false]]],
    ['desktop-computers', 'Desktop Computers', 'DesktopTower', [['processor', 'Processor', 'text', null, null, false, false], ['ram', 'RAM', 'select', ram, null, false, true]]],
    ['tablets', 'Tablets', 'DeviceTablet', [['storage', 'Storage', 'select', storage, null, false, true], ['connectivity', 'Connectivity', 'select', ['Wi-Fi', 'Wi-Fi + Cellular'], null, false, true]]],
    ['monitors', 'Monitors', 'Monitor', [['screen_size', 'Screen size', 'number', null, 'inch', true, false], ['resolution', 'Resolution', 'select', ['HD', 'Full HD', 'QHD', '4K', '5K+'], null, false, true]]],
    ['gaming-consoles', 'Gaming Consoles', 'GameController', [['storage', 'Storage', 'select', storage, null, false, false]]],
    ['cameras', 'Cameras', 'Camera', [['camera_type', 'Type', 'select', ['DSLR', 'Mirrorless', 'Point & shoot', 'Action camera', 'Film', 'Drone'], null, true, true], ['shutter_count', 'Shutter count', 'number', null, null, false, false]]],
    ['headphones', 'Headphones', 'Headphones', [['headphone_type', 'Type', 'select', ['Over-ear', 'On-ear', 'In-ear', 'True wireless'], null, false, true]]],
    ['speakers', 'Speakers', 'SpeakerHifi', []],
    ['smartwatches', 'Smartwatches', 'Watch', [['case_size', 'Case size', 'number', null, 'mm', false, false]]],
    ['electronics-accessories', 'Accessories', 'Plug', []],
    ['televisions', 'Televisions', 'TelevisionSimple', [['screen_size', 'Screen size', 'number', null, 'inch', true, false], ['smart_tv', 'Smart TV', 'boolean', null, null, false, true]]],
    ['home-appliances', 'Home Appliances', 'WashingMachine', [['appliance_type', 'Appliance', 'select', ['Refrigerator', 'Washing machine', 'Air conditioner', 'Microwave', 'Water purifier', 'Air cooler', 'Geyser', 'Other'], null, true, true]]],
    ['computer-components', 'Computer Components', 'Cpu', [['component', 'Component', 'select', ['Graphics card', 'Processor', 'Motherboard', 'RAM', 'Storage', 'Power supply', 'Cabinet', 'Other'], null, true, true]]],
  ]],
  ['vehicles', 'Vehicles', 'CarProfile', '#2F7BFF', 'Cars, bikes, scooters and spare parts.', [
    ['cars', 'Cars', 'CarProfile', [year, km, fuel, ['transmission', 'Transmission', 'select', ['Manual', 'Automatic'], null, true, true], owners, ['registration', 'Registration', 'text', null, null, false, false]]],
    ['motorcycles', 'Motorcycles', 'Motorcycle', [year, km, ['engine_cc', 'Engine', 'number', null, 'cc', false, false], owners]],
    ['scooters', 'Scooters', 'Scooter', [year, km, owners]],
    ['electric-vehicles', 'Electric Vehicles', 'Lightning', [year, km, ['range_km', 'Range', 'number', null, 'km', false, false], ['ev_type', 'Type', 'select', ['Car', 'Scooter', 'Motorcycle', 'Cycle', 'Three-wheeler'], null, true, true]]],
    ['bicycles', 'Bicycles', 'Bicycle', [['frame_size', 'Frame size', 'text', null, null, false, false], ['gears', 'Gears', 'number', null, null, false, false]]],
    ['commercial-vehicles', 'Commercial Vehicles', 'Truck', [year, km, fuel]],
    ['spare-parts', 'Spare Parts', 'GearSix', [['fits', 'Compatible with', 'text', null, null, false, false]]],
    ['vehicle-accessories', 'Accessories', 'SteeringWheel', []],
  ]],
  ['property', 'Property', 'Buildings', '#0EA5A4', 'Homes, rooms, PGs, shops and land.', [
    ['apartments', 'Apartments', 'Buildings', [listingType, bedrooms, ['bathrooms', 'Bathrooms', 'number', null, null, false, false], area, furnishing, ['floor', 'Floor', 'text', null, null, false, false]]],
    ['houses', 'Houses', 'HouseLine', [listingType, bedrooms, area, furnishing]],
    ['rooms', 'Rooms', 'Bed', [furnishing, ['for_whom', 'Suitable for', 'select', ['Anyone', 'Students', 'Working professionals', 'Family'], null, false, true]]],
    ['pg-accommodation', 'PG Accommodation', 'Bed', [['for_whom', 'For', 'select', ['Boys', 'Girls', 'Co-living'], null, true, true], ['meals', 'Meals included', 'boolean', null, null, false, true], ['sharing', 'Sharing', 'select', ['Single', 'Double', 'Triple', 'Dormitory'], null, false, true]]],
    ['rental-properties', 'Rental Properties', 'Key', [bedrooms, furnishing]],
    ['commercial-properties', 'Commercial Properties', 'Storefront', [listingType, area]],
    ['land', 'Land', 'MapTrifold', [listingType, ['plot_area', 'Plot area', 'text', null, null, true, false]]],
  ]],
  ['fashion', 'Fashion', 'TShirt', '#E5487D', 'Clothing, shoes, bags, watches and jewellery.', [
    ['mens-clothing', "Men's Clothing", 'TShirt', [clothSize, color]],
    ['womens-clothing', "Women's Clothing", 'Dress', [clothSize, color]],
    ['kids-clothing', "Kids' Clothing", 'Baby', [['age_group', 'Age', 'select', ['0–2 yrs', '3–5 yrs', '6–9 yrs', '10–14 yrs'], null, false, true]]],
    ['shoes', 'Shoes', 'Sneaker', [['shoe_size', 'Size (UK)', 'select', ['3', '4', '5', '6', '7', '8', '9', '10', '11', '12'], null, false, true]]],
    ['watches', 'Watches', 'Watch', []],
    ['bags', 'Bags', 'Handbag', []],
    ['jewellery', 'Jewellery', 'Diamond', [['material', 'Material', 'select', ['Gold', 'Silver', 'Artificial', 'Other'], null, false, true]]],
    ['fashion-accessories', 'Accessories', 'Sunglasses', []],
  ]],
  ['furniture-home', 'Furniture & Home', 'Couch', '#F59E0B', 'Sofas, beds, appliances and décor.', [
    ['sofas', 'Sofas', 'Couch', [['seats', 'Seats', 'number', null, null, false, false], ['material', 'Material', 'select', ['Fabric', 'Leather', 'Leatherette', 'Wood', 'Other'], null, false, true]]],
    ['beds', 'Beds', 'Bed', [['bed_size', 'Size', 'select', ['Single', 'Double', 'Queen', 'King'], null, false, true]]],
    ['tables', 'Tables', 'Table', []],
    ['chairs', 'Chairs', 'Chair', []],
    ['wardrobes', 'Wardrobes', 'Door', [['doors', 'Doors', 'number', null, null, false, false]]],
    ['kitchen-appliances', 'Kitchen Appliances', 'CookingPot', []],
    ['home-decor', 'Home Décor', 'FlowerTulip', []],
    ['lighting', 'Lighting', 'Lamp', []],
    ['mattresses', 'Mattresses', 'Bed', [['bed_size', 'Size', 'select', ['Single', 'Double', 'Queen', 'King'], null, false, true]]],
  ]],
  ['jobs-services', 'Jobs & Services', 'Briefcase', '#10B981', 'Hire help or offer your skills locally.', [
    ['freelancing', 'Freelancing', 'Briefcase', [exp, ['rate_basis', 'Rate', 'select', ['Per hour', 'Per day', 'Per project', 'Per month'], null, false, true]]],
    ['tutoring', 'Tutoring', 'ChalkboardTeacher', [['subjects', 'Subjects', 'text', null, null, true, false], ['mode', 'Mode', 'select', ['Online', 'At home', 'At centre'], null, false, true], exp]],
    ['photography', 'Photography', 'Aperture', [exp, area2]],
    ['repair-services', 'Repair Services', 'Wrench', [area2, exp]],
    ['design-services', 'Design Services', 'PaintBrush', [exp]],
    ['cleaning', 'Cleaning', 'Broom', [area2]],
    ['professional-services', 'Professional Services', 'UsersThree', [exp]],
    ['local-services', 'Local Services', 'MapPin', [area2]],
  ]],
  ['sports-fitness', 'Sports & Fitness', 'Barbell', '#EF6C35', 'Gym kit, sports gear and outdoor equipment.', [
    ['gym-equipment', 'Gym Equipment', 'Barbell', []],
    ['sports-equipment', 'Sports Equipment', 'SoccerBall', [['sport', 'Sport', 'select', ['Cricket', 'Football', 'Badminton', 'Tennis', 'Basketball', 'Table tennis', 'Other'], null, false, true]]],
    ['fitness-accessories', 'Fitness Accessories', 'Heart', []],
    ['sports-bicycles', 'Bicycles', 'Bicycle', [['gears', 'Gears', 'number', null, null, false, false]]],
    ['outdoor-equipment', 'Outdoor Equipment', 'Tent', []],
  ]],
  ['books-education', 'Books & Education', 'BookOpen', '#8B5CF6', 'Textbooks, novels, study material and instruments.', [
    ['textbooks', 'Textbooks', 'Books', [['exam', 'Course / exam', 'text', null, null, false, false]]],
    ['novels', 'Novels', 'BookOpen', []],
    ['academic-books', 'Academic Books', 'GraduationCap', []],
    ['study-materials', 'Study Materials', 'Books', []],
    ['education-instruments', 'Musical Instruments', 'Guitar', []],
    ['educational-equipment', 'Educational Equipment', 'Calculator', []],
  ]],
  ['gaming-entertainment', 'Gaming & Entertainment', 'Joystick', '#D946EF', 'Games, consoles, collectibles and merch.', [
    ['video-games', 'Video Games', 'Joystick', [['platform', 'Platform', 'select', ['PlayStation 5', 'PlayStation 4', 'Xbox Series', 'Xbox One', 'Nintendo Switch', 'PC'], null, true, true]]],
    ['gaming-accessories', 'Gaming Accessories', 'GameController', []],
    ['consoles', 'Consoles', 'GameController', []],
    ['collectibles-gaming', 'Collectibles', 'Trophy', []],
    ['entertainment-merchandise', 'Entertainment Merchandise', 'VinylRecord', []],
  ]],
  ['baby-kids', 'Baby & Kids', 'BabyCarriage', '#FB7185', 'Toys, prams, cots and kids’ essentials.', [
    ['toys', 'Toys', 'PuzzlePiece', [['age_group', 'Age', 'select', ['0–2 yrs', '3–5 yrs', '6–9 yrs', '10+ yrs'], null, false, true]]],
    ['baby-furniture', 'Baby Furniture', 'Armchair', []],
    ['strollers', 'Strollers', 'BabyCarriage', []],
    ['baby-accessories', 'Baby Accessories', 'Baby', []],
    ['childrens-products', "Children's Products", 'Cube', []],
  ]],
  ['pets-supplies', 'Pets & Supplies', 'PawPrint', '#14B8A6', 'Accessories, food, aquariums and equipment. Live animals are not allowed.', [
    ['pet-accessories', 'Pet Accessories', 'PawPrint', []],
    ['pet-supplies', 'Pet Supplies', 'BowlFood', []],
    ['aquariums', 'Aquariums', 'Fish', []],
    ['pet-equipment', 'Pet Equipment', 'Dog', []],
  ]],
  ['business-industrial', 'Business & Industrial', 'Factory', '#64748B', 'Office kit, machinery, tools and supplies.', [
    ['office-equipment', 'Office Equipment', 'Printer', []],
    ['machinery', 'Machinery', 'Factory', []],
    ['commercial-equipment', 'Commercial Equipment', 'Warehouse', []],
    ['tools', 'Tools', 'Toolbox', []],
    ['industrial-supplies', 'Industrial Supplies', 'Package', []],
  ]],
  ['other', 'Other', 'DotsThreeCircle', '#A855F7', 'Art, antiques, garden and everything else that is allowed.', [
    ['art', 'Art', 'Palette', []],
    ['collectibles', 'Collectibles', 'Crown', []],
    ['antiques', 'Antiques', 'Hourglass', []],
    ['garden-equipment', 'Garden Equipment', 'Plant', []],
    ['musical-instruments', 'Musical Instruments', 'PianoKeys', [['instrument', 'Instrument', 'select', ['Guitar', 'Keyboard / piano', 'Drums', 'Violin', 'Flute', 'Tabla', 'Harmonium', 'Madal', 'Other'], null, false, true]]],
    ['miscellaneous', 'Miscellaneous', 'ShoppingBag', []],
  ]],
];

// Categories that cannot be delivered (services/property) and those requiring manual review.
export const NO_DELIVERY = new Set(['property', 'jobs-services']);
export const REVIEW = new Set(['pets-supplies', 'antiques']);
